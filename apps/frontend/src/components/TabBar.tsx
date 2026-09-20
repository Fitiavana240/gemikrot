import { NavLink } from 'react-router-dom';

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
  return (
    <div className="-mx-1 overflow-x-auto">
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
