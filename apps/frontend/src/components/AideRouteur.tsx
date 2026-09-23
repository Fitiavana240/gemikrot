import { useState } from 'react';

/**
 * « Où est-ce que je trouve ça ? »
 *
 * Les formulaires de raccordement demandent une adresse, un port, une version,
 * un nom de domaine. Un exploitant qui n'est pas informaticien sait son mot de
 * passe et rien d'autre : le reste, il le devine, et il se trompe. Le champ
 * reste vide, ou pire il se remplit d'une valeur plausible et fausse — c'est
 * ainsi qu'on passe une heure sur un port qui n'était pas le bon.
 *
 * **Chaque ligne donne les deux chemins**, parce que les gens ne travaillent
 * pas de la même façon : le menu Winbox pour qui clique, la commande pour qui
 * tape. La commande se copie d'un bouton — la retaper à la main dans un
 * terminal est la meilleure façon d'y glisser une faute.
 *
 * **Replié par défaut.** L'aide qui s'impose à celui qui sait déjà devient du
 * bruit, et on finit par ne plus voir l'écran sous les explications.
 *
 * **Aucune de ces commandes n'écrit.** Ce sont toutes des lectures : on peut
 * les passer sur un routeur en production sans rien risquer, et c'est dit,
 * parce que quelqu'un qui hésite à taper une commande sur le routeur qui
 * nourrit ses clients a parfaitement raison d'hésiter.
 */

export interface LigneAide {
  /** Ce qu'on cherche, dans les mots du formulaire. */
  quoi: string;
  /** Le chemin dans les menus de Winbox. */
  ou: string;
  /** La commande à taper dans New Terminal. Lecture seule, toujours. */
  commande: string;
  /** Ce qu'on lit dans le résultat, quand ce n'est pas évident. */
  detail?: string;
}

function BoutonCopier({ texte }: { texte: string }) {
  const [copie, setCopie] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(texte).then(
          () => {
            setCopie(true);
            // Le retour s'efface seul : un « copié » qui reste fait douter de
            // ce qui est dans le presse-papier au bout de trois copies.
            setTimeout(() => setCopie(false), 1500);
          },
          () => setCopie(false),
        );
      }}
      className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
      aria-label={`Copier : ${texte}`}
    >
      {copie ? 'copié' : 'copier'}
    </button>
  );
}

export function AideRouteur({
  titre = 'Où trouver ces informations sur le routeur ?',
  lignes,
  note,
}: {
  titre?: string;
  lignes: LigneAide[];
  /** Ce qui ne se trouve pas sur le routeur, ou ce qu'il faut savoir en plus. */
  note?: React.ReactNode;
}) {
  return (
    <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <summary className="cursor-pointer font-medium text-slate-700">{titre}</summary>

      <p className="mt-2 text-xs text-slate-500">
        Dans Winbox, ouvrez <strong>New Terminal</strong> et collez la commande. Toutes celles-ci
        se contentent de <strong>lire</strong> : aucune ne modifie quoi que ce soit sur votre
        routeur.
      </p>

      <ul className="mt-3 space-y-3">
        {lignes.map((ligne) => (
          <li key={ligne.quoi}>
            <p className="font-medium text-slate-800">{ligne.quoi}</p>
            <p className="text-xs text-slate-500">Dans Winbox : {ligne.ou}</p>
            <div className="mt-1 flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100">
                {ligne.commande}
              </code>
              <BoutonCopier texte={ligne.commande} />
            </div>
            {ligne.detail && <p className="mt-1 text-xs text-slate-600">{ligne.detail}</p>}
          </li>
        ))}
      </ul>

      {note && <div className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-600">{note}</div>}
    </details>
  );
}

/**
 * Ce qu'il faut pour raccorder un routeur, et où le lire.
 *
 * L'ordre suit celui du formulaire : on cherche pendant qu'on remplit, pas
 * après. Le mot de passe n'y figure pas, et il ne peut pas y figurer — RouterOS
 * ne le rend jamais en clair, même à `admin`. C'est dit explicitement, sinon
 * on le cherche.
 */
export const AIDE_RACCORDEMENT: LigneAide[] = [
  {
    quoi: "L'adresse du routeur",
    ou: 'IP > Addresses',
    commande: '/ip/address print',
    detail:
      "Celle du réseau depuis lequel vous travaillez, souvent 192.168.88.1. Ignorez les adresses en 10.88.x.y : c'est le tunnel de GeMikrot.",
  },
  {
    quoi: 'Le port sécurisé, et si le service est actif',
    ou: 'IP > Services',
    commande: '/ip/service print where name=www-ssl',
    detail:
      "La colonne « port » donne la valeur à saisir (443 par défaut). Si la ligne est marquée X, le service est éteint et la console ne pourra pas se connecter.",
  },
  {
    quoi: 'La version de RouterOS',
    ou: 'System > Resources',
    commande: '/system/resource print',
    detail: 'Le raccordement demande la version 7 ou plus récente.',
  },
  {
    quoi: 'Le nom du routeur',
    ou: 'System > Identity',
    commande: '/system/identity print',
    detail: "Repris tel quel dans la console si vous ne saisissez pas d'autre nom.",
  },
  {
    quoi: 'Le paquet WireGuard, sans lequel le tunnel est impossible',
    ou: 'System > Packages',
    commande: '/system/package print',
    detail: "Cherchez « wireguard » dans la liste. Il est intégré à RouterOS 7, pas à la 6.",
  },
  {
    quoi: 'Le nom du réseau Wi-Fi',
    ou: 'Wireless (ou WiFi selon la version)',
    commande: '/interface/wireless print',
    detail:
      "La colonne « ssid » porte le nom que voient vos clients. Sur les RouterOS 7 récents le menu s'appelle WiFi : la commande est alors /interface/wifi print.",
  },
  {
    quoi: 'Le nom DNS du portail captif',
    ou: 'IP > Hotspot > Server Profiles',
    commande: '/ip/hotspot/profile print',
    detail:
      "Le champ « dns-name » — par exemple wifitati.net. C'est l'adresse à laquelle le routeur redirige vos clients avant qu'ils aient payé.",
  },
  {
    quoi: 'Les autres ports du routeur',
    ou: 'IP > Services',
    commande: '/ip/service print',
    detail:
      "La liste complète : www (WebFig, 80), api (8728), winbox (8291), www-ssl (443). GeMikrot n'utilise que www-ssl — les autres sont là pour votre information.",
  },
  {
    quoi: 'Les comptes existants sur le routeur',
    ou: 'System > Users',
    commande: '/user print',
    detail:
      "Pour retrouver votre identifiant. Les mots de passe ne s'affichent jamais, sur aucun routeur : si vous avez perdu le vôtre, il faut le redéfinir depuis Winbox.",
  },
];

/**
 * Le tunnel a-t-il monté ? Les lectures qui répondent.
 *
 * WireGuard n'a pas d'état « connecté » : une interface qui tourne ne dit rien
 * du lien. La dernière poignée de main est le seul indicateur qui vaille, et
 * c'est celui qu'on ne pense jamais à regarder.
 */
export const AIDE_TUNNEL: LigneAide[] = [
  {
    quoi: 'Le tunnel a-t-il déjà répondu ?',
    ou: 'WireGuard > Peers',
    commande: '/interface/wireguard/peers print detail',
    detail:
      "« last-handshake » est la seule réponse qui compte : absent, le tunnel n'a jamais été établi ; plus vieux que trois minutes, le pair ne répond plus. Comparez aussi « tx » et « rx » — des octets émis et zéro reçu, c'est que personne ne répond à l'adresse du serveur, presque toujours une adresse périmée ou un port fermé.",
  },
  {
    quoi: "L'interface et sa clé publique",
    ou: 'WireGuard',
    commande: '/interface/wireguard print detail',
    detail: 'La clé privée reste sur le routeur et ne s’affiche pas : c’est voulu.',
  },
  {
    quoi: 'La route vers le serveur',
    ou: 'IP > Routes',
    commande: '/ip/route print where comment="GeMikrot"',
    detail:
      "Sans elle, le routeur sait recevoir les appels du serveur mais pas lui répondre — un tunnel qui semble marcher à moitié.",
  },
  {
    quoi: 'Le compte dont se sert la console',
    ou: 'System > Users',
    commande: '/user print where name=gemikrot-api',
    detail:
      "Il doit exister et appartenir au groupe « gemikrot ». Le supprimer coupe la console, sans toucher au Wi-Fi de vos clients.",
  },
];
