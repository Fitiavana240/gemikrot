import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

export interface TabDef {
  /** Segment d'adresse, ex. `comptes` pour `/hotspot/comptes`. */
  to: string;
  label: string;
  /** Vrai pour l'onglet montré quand l'adresse n'en précise aucun. */
  défaut?: boolean;
}

/**
 * Barre d'onglets d'un écran, à la manière de WinBox.
 *
 * Le parent vit dans le menu de gauche, ses tables en onglets ici : c'est la
 * disposition de WinBox, et elle a une raison. Mettre chaque table dans le
 * menu latéral l'allonge jusqu'à devoir le parcourir en entier ; les garder
 * côte à côte montre d'un coup ce que le parent contient, et ce qu'on n'a pas
 * encore ouvert.
 *
 * Chaque onglet est un lien et non un bouton : la table courante se partage
 * par son adresse, et le retour arrière du navigateur fait ce qu'on attend.
 * Elle défile horizontalement plutôt que de se replier sur un téléphone —
 * onze onglets sur deux lignes se lisent moins bien qu'une bande qu'on fait
 * glisser.
 */
export function TabBar({ base, tabs }: { base: string; tabs: TabDef[] }) {
  const piste = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  /**
   * Ramener l'onglet actif dans le champ de vision.
   *
   * Sans cela, arriver sur le onzième onglet d'un téléphone affiche une bande
   * qui commence au premier : l'écran montre un contenu dont l'intitulé est
   * hors cadre, et rien ne paraît sélectionné. Le défaut n'existait pas à
   * cinq onglets ; il est apparu en les doublant.
   *
   * `block: 'nearest'` est indispensable : sans lui, le navigateur fait aussi
   * défiler la page verticalement pour centrer l'onglet, et l'écran s'ouvre
   * en sautant le titre.
   */
  useEffect(() => {
    const actif = piste.current?.querySelector('[aria-current="page"]');
    actif?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  return (
    // La bande colle à ce qu'elle surmonte : le conteneur de page espace ses
    // enfants, et cet écart poussait la table à mi-hauteur. Une barre
    // d'onglets détachée de son contenu ne dit plus de quoi elle est l'onglet.
    <div ref={piste} className="-mx-1 -mb-2 overflow-x-auto">
      <nav className="flex min-w-max gap-1 border-b border-slate-200 px-1">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={`${base}/${tab.to}`}
            end={false}
            className={({ isActive }) =>
              `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-sky-600 text-sky-700'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
