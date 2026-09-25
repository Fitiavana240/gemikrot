import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { AdminRole } from '../api/types';
import { groupeDe, navPourRole } from './nav';
import { IconeCadenas, IconeChevron } from './icones';

const MÉMOIRE = 'gemikrot_menus_replies';

/** Les groupes repliés, retenus d'une visite à l'autre. */
function lireRepliés(): string[] {
  try {
    const brut = localStorage.getItem(MÉMOIRE);
    return brut ? (JSON.parse(brut) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Navigation en groupes repliables.
 *
 * Trois règles, et chacune répond à une gêne constatée sur la liste à plat.
 *
 * Le groupe de la page courante s'ouvre tout seul : arriver sur un écran par
 * un lien et ne pas voir où l'on se trouve dans le menu est désorientant.
 *
 * Replier est mémorisé : un vendeur qui n'ouvre jamais « Réseau » ne devrait
 * pas le voir se redéployer à chaque connexion.
 *
 * Un groupe replié qui contient la page courante reste ouvert malgré tout —
 * masquer l'endroit où l'on est serait pire que de désobéir au repli.
 */
/** Qui peut ouvrir cette entree, dit en francais plutot qu'en constantes. */
function roleQuiPeut(roles: AdminRole[] | undefined): string {
  if (!roles) return 'tout compte connecté';
  if (roles.includes('ADMIN')) return "l'exploitant";
  if (roles.includes('SUPER_ADMIN')) return "l'administrateur de la plateforme";
  return 'un autre rôle';
}

export function SideNav({ role }: { role: AdminRole | undefined }) {
  const { pathname } = useLocation();
  const [repliés, setRepliés] = useState<string[]>(lireRepliés);
  const groupeActif = groupeDe(pathname);

  useEffect(() => {
    try {
      localStorage.setItem(MÉMOIRE, JSON.stringify(repliés));
    } catch {
      // Navigation privée ou stockage refusé : le menu marche quand même,
      // il oublie simplement les replis.
    }
  }, [repliés]);

  function basculer(id: string) {
    setRepliés((liste) => (liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id]));
  }

  return (
    <nav className="space-y-4">
      {navPourRole(role).map((groupe) => {
        const ouvert = !repliés.includes(groupe.id) || groupe.id === groupeActif;

        return (
          <div key={groupe.id}>
            <button
              type="button"
              onClick={() => basculer(groupe.id)}
              aria-expanded={ouvert}
              className="flex w-full items-center justify-between rounded px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-600"
            >
              {groupe.label}
              {/* Un `›` tenait lieu d'icône : un guillemet simple, dessiné
                  dans la police du système, donc d'une épaisseur et d'une
                  hauteur qui ne sont celles d'aucune autre marque de cette
                  console. Le chevron du jeu porte le trait de toutes les
                  autres. */}
              <IconeChevron
                className={`h-3.5 w-3.5 shrink-0 text-slate-300 transition-transform duration-200 ${
                  ouvert ? 'rotate-90' : ''
                }`}
              />
            </button>

            {ouvert && (
              <div className="mt-1 space-y-0.5">
                {groupe.items.map((item) =>
                  /* **Une entree verrouillee n'est pas un lien.** Un `NavLink`
                     grise se clique quand meme au clavier, et mene a un
                     refus du serveur -- exactement ce qu'on voulait eviter en
                     les cachant autrefois. Ici, rien a cliquer : seulement
                     une ligne qui dit que la chose existe et a qui elle
                     appartient. */
                  item.verrouillé ? (
                    <div
                      key={item.to}
                      title={`Réservé à ${roleQuiPeut(item.roles)}. Demandez-le à votre exploitant.`}
                      className="flex cursor-not-allowed items-center gap-2.5 border-l-2 border-transparent py-1.5 pl-3 pr-2 text-sm text-slate-400"
                    >
                      <item.icone className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <IconeCadenas className="h-3.5 w-3.5 shrink-0" />
                    </div>
                  ) : (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    title={item.hint}
                    className={({ isActive }) =>
                      // La barre à gauche marque la page courante sans déplacer
                      // le texte : un décalage à chaque changement de page
                      // fait sautiller la lecture.
                      `flex items-center gap-2.5 border-l-2 py-1.5 pl-3 pr-2 text-sm transition-colors ${
                        isActive
                          ? 'border-sky-600 bg-sky-50 font-medium text-sky-700'
                          : 'border-transparent text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`
                    }
                  >
                    {/* `shrink-0` : sans lui, un libellé long comprime son
                        icône et le jeu perd sa régularité — c'est la seule
                        chose qu'on remarque dans une colonne d'icônes. */}
                    <item.icone className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
