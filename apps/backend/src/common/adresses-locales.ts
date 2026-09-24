import { networkInterfaces } from 'node:os';

/**
 * Où la console répond, et comment savoir qu'elle a déménagé.
 *
 * Deux endroits du produit inscrivent l'adresse de la console dans un fichier
 * qui vit **ailleurs** : la page captive, posée sur le routeur, et le script
 * d'enrôlement, collé dans un terminal Winbox. Ni l'un ni l'autre ne peut
 * réagir quand le bail DHCP glisse — et il glisse.
 *
 * C'est arrivé deux fois sur cette installation. La page captive envoyait les
 * clients sur `192.168.88.250` quand la console répondait sur `.135` ; puis le
 * script d'enrôlement annonçait `.135` quand elle répondait sur `.23`. Dans
 * les deux cas **l'échec est muet** : le client voit « connexion refusée », le
 * routeur reste sur « status: connecting », et personne ne fait le lien avec
 * une adresse.
 *
 * Le remède durable est une réservation DHCP sur le routeur. En attendant, le
 * moins que la console puisse faire est de constater l'écart et de le dire
 * avant qu'on publie ou qu'on colle quoi que ce soit.
 */

/** Les adresses IPv4 de cette machine, cartes internes exclues. */
export function adressesLocales(): string[] {
  const trouvees: string[] = [];
  for (const liste of Object.values(networkInterfaces())) {
    for (const carte of liste ?? []) {
      if (carte.family === 'IPv4' && !carte.internal) trouvees.push(carte.address);
    }
  }
  return trouvees;
}

/** Vrai pour `192.168.88.23`, faux pour `wifitati.net` ou `10.0.0`. */
export function estIPv4(hote: string): boolean {
  const parts = hote.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * Cette adresse est-elle d'un reseau prive ?
 *
 * La distinction decide de tout ici. Une adresse **privee** absente des cartes
 * de la machine a vraiment perime : elle designait ce poste sur ce reseau, et
 * ne le designe plus. Une adresse **publique** absente des cartes est au
 * contraire la situation normale — le serveur est derriere du NAT, son adresse
 * publique appartient a la box, jamais a sa propre carte reseau.
 *
 * Sans cette distinction, annoncer l'adresse publique du serveur pour du
 * raccordement distant declenchait une alerte << adresse perimee >> a chaque
 * ouverture du formulaire, sur une configuration parfaitement juste. Une
 * alerte qui se trompe fait douter de toutes les autres.
 */
export function estPrivee(hote: string): boolean {
  if (!estIPv4(hote)) return false;
  const [a, b] = hote.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    // Lien-local : ce que rend une machine sans bail DHCP.
    (a === 169 && b === 254)
  );
}

/**
 * Deux adresses sur le même /24 ?
 *
 * Le masque réel n'est pas lu : celui de la console ne dit rien de celui du
 * routeur, et un HotSpot de quartier tient dans un /24. Une supposition, mais
 * une supposition qui ne décide de rien — elle ne fait que **proposer** une
 * adresse, que l'exploitant confirme ou remplace.
 */
export function memeReseau24(a: string, b: string): boolean {
  const ta = a.split('.');
  const tb = b.split('.');
  if (ta.length !== 4 || tb.length !== 4) return false;
  return ta[0] === tb[0] && ta[1] === tb[1] && ta[2] === tb[2];
}

export interface AdressePerimee {
  /** Ce que la configuration annonce, et que plus rien ne sert. */
  configuree: string;
  /**
   * Ce qu'il faudrait mettre à la place, quand on peut le déduire sans
   * risque : une adresse de cette machine sur le même /24. `null` sinon —
   * proposer une carte virtuelle Hyper-V ou WSL serait pire que se taire,
   * puisqu'elle est injoignable depuis le Wi-Fi.
   */
  actuelle: string | null;
}

/**
 * L'adresse configurée est-elle encore celle de cette machine ?
 *
 * **Un nom de domaine n'est jamais périmé**, et c'est délibéré : une mise en
 * production sérieuse annonce `console.exemple.net`, que cette machine ne
 * porte évidemment pas sur une carte réseau.
 *
 * **Une adresse publique non plus.** Un serveur derrière du NAT annonce
 * l'adresse de sa box, qui n'est sur aucune de ses cartes : son absence est
 * la normale, pas un symptôme. Signaler ce cas déclenchait une alerte à
 * chaque ouverture du formulaire de raccordement distant, sur une
 * configuration parfaitement juste — et une alerte qui se trompe fait douter
 * de toutes les autres.
 *
 * Reste donc le seul cas qui pourrit vraiment : une **adresse privée** écrite
 * en dur que cette machine ne porte plus.
 */
export function adressePerimee(
  hote: string,
  locales: string[] = adressesLocales(),
): AdressePerimee | null {
  if (!estIPv4(hote)) return null;
  // Une adresse publique n'est jamais sur une carte de cette machine quand
  // elle est derriere du NAT : son absence ne prouve rien, et la signaler
  // criait au loup sur une configuration juste.
  if (!estPrivee(hote)) return null;
  if (locales.includes(hote)) return null;

  return {
    configuree: hote,
    actuelle: locales.find((ip) => memeReseau24(ip, hote)) ?? null,
  };
}

/** L'hôte d'une URL, sans le port ni le schéma. Vide si elle est illisible. */
export function hoteDeLUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
