import qrcode from 'qrcode-generator';

/**
 * Un QR code prêt à poser dans un `<img src>` d'un gabarit de ticket.
 *
 * **SVG et non image matricielle.** Un ticket est imprimé, souvent sur une
 * cellule de 15 mm : une image de quelques dizaines de pixels y sortirait
 * floue, et un QR flou ne se lit pas. Le SVG reste net à n'importe quelle
 * taille, et pèse moins qu'un PNG équivalent.
 *
 * Le niveau de correction `M` (15 %) est un compromis assumé : `L` tient sur
 * moins de modules mais ne pardonne pas une bavure d'encre ni un pli, `H`
 * grossit le motif au point de rendre chaque module minuscule sur une
 * cellule de cette taille — ce qui nuit plus qu'il n'aide.
 */
export function qrDataUri(contenu: string): string {
  // `0` laisse la bibliothèque choisir la plus petite version qui contient
  // les données : un code de dix caractères n'a pas à payer la place d'une
  // URL longue.
  const qr = qrcode(0, 'M');
  qr.addData(contenu);
  qr.make();

  // `scalable` produit un `viewBox` sans dimensions figées : l'image prend la
  // taille que le gabarit lui donne en CSS, en millimètres s'il le veut.
  const svg = qr.createSvgTag({ cellSize: 1, margin: 1, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/**
 * Ce que le QR doit encoder pour qu'un scan connecte réellement le client.
 *
 * Avec un domaine de portail déclaré, c'est l'adresse de connexion du
 * HotSpot : le client rejoint le Wi-Fi, scanne, et se retrouve connecté sans
 * avoir rien saisi. RouterOS accepte les identifiants en paramètres sur
 * `/login`, et le code sert à la fois de nom et de mot de passe.
 *
 * Sans domaine, le QR ne contient que le code. C'est moins bien — il faudra
 * le coller dans le portail — mais cela reste mieux que de recopier dix
 * caractères à la main, ce qui est l'erreur que ce code existe pour éviter.
 */
export function contenuQr(code: string, domaines: string[]): string {
  const domaine = domaines.find((d) => d.trim() !== '')?.trim();
  if (!domaine) return code;

  const encodé = encodeURIComponent(code);
  return `http://${domaine}/login?username=${encodé}&password=${encodé}`;
}
