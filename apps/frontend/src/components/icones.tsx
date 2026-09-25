import type { ReactElement, SVGProps } from 'react';

/**
 * Les icônes de la console, dessinées ici.
 *
 * **Aucune dépendance.** Une bibliothèque d'icônes apporte deux mille dessins
 * pour en servir vingt, et un verrou de dépendances de plus à faire passer par
 * la construction Docker. Vingt tracés tiennent dans ce fichier.
 *
 * **Un seul trait pour toutes.** C'est la règle qui fait qu'un jeu d'icônes
 * ressemble à un jeu plutôt qu'à une collection : même grille de 24, même
 * épaisseur, mêmes extrémités arrondies, aucun remplissage. Le tracé prend la
 * couleur du texte, donc une icône dans un lien actif devient bleue avec lui,
 * sans qu'on ait à le prévoir.
 *
 * **Elles ne portent aucune information seule.** Chaque icône accompagne un
 * libellé écrit et reste `aria-hidden` : un lecteur d'écran lit « Tickets »,
 * pas « Tickets, image ». Une icône qui serait le seul indice de sa fonction
 * exclurait ceux qui ne la reconnaissent pas — et une icône se reconnaît
 * moins bien qu'on ne le croit.
 */
function Icone({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      // 1.5 à 24 px : assez dense pour tenir à côté d'un texte de 14 px sans
      // pâlir, assez fin pour ne pas boucher les tracés à 16 px.
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export type Icône = (props: SVGProps<SVGSVGElement>) => ReactElement;

/** Vue d'ensemble : une jauge, parce qu'on y lit un état d'un coup d'œil. */
export const IconeJauge: Icône = (p) => (
  <Icone {...p}>
    {/* Deux tracés, pas quatre. Les graduations aux extrémités de l'arc
        tenaient à 24 px et se confondaient avec lui à 16 px — la taille à
        laquelle cette icône passe sa vie, dans le menu. */}
    <path d="M4 17a8 8 0 0 1 16 0" />
    <path d="M12 17l4.6-4.6" />
  </Icone>
);

export const IconeTicket: Icône = (p) => (
  <Icone {...p}>
    <path d="M4 9.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2.5 2.5 0 0 0 0 5 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2.5 2.5 0 0 0 0-5Z" />
    <path d="M14 7.5v2" />
    <path d="M14 11v2" />
    <path d="M14 14.5v2" />
  </Icone>
);

export const IconeBillet: Icône = (p) => (
  <Icone {...p}>
    <rect x="3" y="6.5" width="18" height="11" rx="2" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M6.5 12h.01" />
    <path d="M17.5 12h.01" />
  </Icone>
);

/** Recettes : la courbe qui monte, seul dessin que personne ne confond. */
export const IconeCourbe: Icône = (p) => (
  <Icone {...p}>
    <path d="M4 18V6" />
    <path d="M4 18h16" />
    <path d="M7.5 15l3.5-4 3 2.5L20 8" />
  </Icone>
);

export const IconeClients: Icône = (p) => (
  <Icone {...p}>
    <circle cx="9.5" cy="8.5" r="3" />
    <path d="M4 19a5.5 5.5 0 0 1 11 0" />
    <path d="M16 6.2a3 3 0 0 1 0 5.6" />
    <path d="M17 14.4a5.5 5.5 0 0 1 3 4.6" />
  </Icone>
);

/** Abonnements : un calendrier, parce que leur échéance est calendaire. */
export const IconeCalendrier: Icône = (p) => (
  <Icone {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17" />
    <path d="M8 3.5v3" />
    <path d="M16 3.5v3" />
    <path d="M9 14.8l2.2 2.2 4-4" />
  </Icone>
);

export const IconeAppareil: Icône = (p) => (
  <Icone {...p}>
    <rect x="7" y="2.8" width="10" height="18.4" rx="2.2" />
    <path d="M10.8 18.4h2.4" />
    <path d="M10.4 5.6h3.2" />
  </Icone>
);

/** Connectés : un pouls. Ce qui est en ligne maintenant, et rien d'autre. */
export const IconePouls: Icône = (p) => (
  <Icone {...p}>
    <path d="M3 12h3.6l2-5.4 3.2 11 2.2-5.6h6" />
  </Icone>
);

export const IconeRouteur: Icône = (p) => (
  <Icone {...p}>
    <rect x="3" y="13" width="18" height="6.5" rx="2" />
    <path d="M7 16.2h.01" />
    <path d="M11 16.2h6" />
    <path d="M7.5 13l-2-4" />
    <path d="M16.5 13l2-4" />
  </Icone>
);

export const IconeDiagnostic: Icône = (p) => (
  <Icone {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.4 15.4 20 20" />
    <path d="M7.4 10.5h1.6l1-2 1.4 4 1-2h1.7" />
  </Icone>
);

/** HotSpot : les ondes de la marque, reprises au trait du jeu. */
export const IconeOndes: Icône = (p) => (
  <Icone {...p}>
    <path d="M4 11a11 11 0 0 1 16 0" />
    <path d="M7.2 14.2a6.5 6.5 0 0 1 9.6 0" />
    <path d="M12 18.6h.01" />
  </Icone>
);

/** User Manager : une carte nominative — c'est ce qu'il délivre. */
export const IconeCarte: Icône = (p) => (
  <Icone {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <circle cx="8.8" cy="11" r="2" />
    <path d="M5.8 15.6a3.2 3.2 0 0 1 6 0" />
    <path d="M14.5 10h3.8" />
    <path d="M14.5 13.4h3.8" />
  </Icone>
);

/** PPPoE : une liaison, deux maillons qui tiennent ensemble. */
export const IconeLiaison: Icône = (p) => (
  <Icone {...p}>
    <path d="M10.2 13.8 13.8 10.2" />
    <path d="M9.4 7.6 10.8 6.2a3.6 3.6 0 0 1 5 5l-1.4 1.4" />
    <path d="M14.6 16.4 13.2 17.8a3.6 3.6 0 0 1-5-5l1.4-1.4" />
  </Icone>
);

export const IconeEtiquette: Icône = (p) => (
  <Icone {...p}>
    <path d="M4 11.4V5.2a1.2 1.2 0 0 1 1.2-1.2h6.2a1.2 1.2 0 0 1 .85.35l7.4 7.4a1.2 1.2 0 0 1 0 1.7l-6.2 6.2a1.2 1.2 0 0 1-1.7 0l-7.4-7.4A1.2 1.2 0 0 1 4 11.4Z" />
    <path d="M8 8h.01" />
  </Icone>
);

export const IconeReglages: Icône = (p) => (
  <Icone {...p}>
    <path d="M4 7.5h8.5" />
    <path d="M18.5 7.5H20" />
    <path d="M4 16.5h5.5" />
    <path d="M15.5 16.5H20" />
    <circle cx="15.5" cy="7.5" r="2.4" />
    <circle cx="12.5" cy="16.5" r="2.4" />
  </Icone>
);

export const IconeEquipe: Icône = (p) => (
  <Icone {...p}>
    <circle cx="9.5" cy="8.5" r="3" />
    <path d="M4 19a5.5 5.5 0 0 1 11 0" />
    <path d="M18.5 8v5" />
    <path d="M16 10.5h5" />
  </Icone>
);

/** Mon abonnement : un reçu, avec son bord déchiré. */
export const IconeRecu: Icône = (p) => (
  <Icone {...p}>
    <path d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6L6 18.9Z" />
    <path d="M9.4 8.5h5.2" />
    <path d="M9.4 12.2h5.2" />
  </Icone>
);

export const IconeJournal: Icône = (p) => (
  <Icone {...p}>
    <path d="M4.5 6.5h.01" />
    <path d="M4.5 12h.01" />
    <path d="M4.5 17.5h.01" />
    <path d="M8.5 6.5H20" />
    <path d="M8.5 12H20" />
    <path d="M8.5 17.5H20" />
  </Icone>
);

export const IconeSupervision: Icône = (p) => (
  <Icone {...p}>
    <path d="M2.8 12S6.5 6.2 12 6.2 21.2 12 21.2 12 17.5 17.8 12 17.8 2.8 12 2.8 12Z" />
    <circle cx="12" cy="12" r="2.6" />
  </Icone>
);

/** Exploitants : un immeuble. Chacun tient sa maison, on gère les comptes. */
export const IconeImmeuble: Icône = (p) => (
  <Icone {...p}>
    <path d="M4 20.5V4.8a1 1 0 0 1 1-1h7.5a1 1 0 0 1 1 1v15.7" />
    <path d="M13.5 20.5V10.5H19a1 1 0 0 1 1 1v9" />
    <path d="M2.8 20.5h18.4" />
    <path d="M7 7.6h3.5" />
    <path d="M7 11.6h3.5" />
    <path d="M7 15.6h3.5" />
    <path d="M16.5 14.6h.01" />
  </Icone>
);

/**
 * Le chevron des groupes repliables.
 *
 * Il remplace un `›` : un guillemet simple tenait lieu d'icône, et se dessine
 * dans la police du système — donc d'une épaisseur et d'une hauteur qui ne
 * sont celles d'aucune autre marque de cette console.
 */
export const IconeChevron: Icône = (p) => (
  <Icone {...p}>
    <path d="M9.5 6.5 15 12l-5.5 5.5" />
  </Icone>
);
