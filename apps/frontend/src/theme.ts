/**
 * Le thème clair ou sombre, posé sur la racine du document.
 *
 * **Aucune page n'a été retouchée.** Tailwind v4 compile `bg-white` en
 * `background-color: var(--color-white)` : redéfinir ces variables sous une
 * classe retourne toute l'application d'un coup. L'autre chemin — ajouter
 * `dark:` à la main — aurait demandé 838 retouches réparties sur 62 fichiers,
 * et il en serait resté.
 *
 * Le choix est gardé dans le navigateur, pas en base : c'est une préférence
 * d'écran, pas une donnée d'exploitation. Le même compte ouvert sur le
 * téléphone du comptoir et sur l'ordinateur du bureau peut légitimement
 * vouloir deux réglages — l'un se lit en plein soleil, l'autre le soir.
 */

export type Theme = 'clair' | 'sombre' | 'systeme';

const CLEF = 'gemikrot_theme';

/** Ce que le système d'exploitation annonce, quand on le suit. */
function préférenceSystème(): 'clair' | 'sombre' {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'sombre' : 'clair';
  } catch {
    return 'clair';
  }
}

export function lireTheme(): Theme {
  try {
    const v = localStorage.getItem(CLEF);
    return v === 'clair' || v === 'sombre' || v === 'systeme' ? v : 'systeme';
  } catch {
    // Navigation privée, stockage bloqué : le défaut s'applique, et rien ne
    // casse. Une préférence d'affichage ne doit jamais empêcher d'afficher.
    return 'systeme';
  }
}

export function appliquerTheme(theme: Theme): void {
  const effectif = theme === 'systeme' ? préférenceSystème() : theme;
  document.documentElement.classList.toggle('sombre', effectif === 'sombre');
  // `color-scheme` fait suivre ce que le navigateur dessine lui-même : barres
  // de défilement, champs de formulaire natifs, sélecteur de date. Sans lui,
  // une page sombre garde un calendrier blanc éclatant.
  document.documentElement.style.colorScheme = effectif === 'sombre' ? 'dark' : 'light';
}

export function poserTheme(theme: Theme): void {
  try {
    localStorage.setItem(CLEF, theme);
  } catch {
    /* stockage indisponible : le choix vaut pour cette session */
  }
  appliquerTheme(theme);
}

/**
 * Suit le système tant que l'exploitant n'a rien choisi.
 *
 * Rendu au premier chargement, avant React : sans cela, l'application
 * s'affiche en clair une fraction de seconde avant de basculer, et ce
 * clignotement blanc est exactement ce qu'on cherche à éviter le soir.
 */
export function installerTheme(): () => void {
  appliquerTheme(lireTheme());
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const suivre = () => {
    if (lireTheme() === 'systeme') appliquerTheme('systeme');
  };
  media?.addEventListener?.('change', suivre);
  return () => media?.removeEventListener?.('change', suivre);
}
