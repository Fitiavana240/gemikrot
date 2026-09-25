import { useEffect, useId, useState, type ReactNode } from 'react';
import { IconeChevron } from './icones';

const MÉMOIRE = 'gemikrot.sections';

/**
 * Ce que l'exploitant a decide, section par section.
 *
 * **Une table et non une liste**, et c'est la difference qui compte : une
 * liste d'identifiants ouverts ne distingue pas << jamais touche >> de
 * << referme expres >>. Une section ouverte par defaut ne pouvait alors plus
 * se refermer -- on cliquait, le chevron ne bougeait pas, rien ne se
 * passait. Constate en cliquant, pas en relisant.
 */
type Choix = Record<string, boolean>;

function lireChoix(): Choix {
  try {
    const brut = localStorage.getItem(MÉMOIRE);
    const valeur: unknown = brut ? JSON.parse(brut) : null;
    // Ni un tableau ni autre chose : seule une table de booleens est lue. Le
    // reste repart a zero plutot que de faire des `undefined` partout.
    return valeur && typeof valeur === 'object' && !Array.isArray(valeur)
      ? (valeur as Choix)
      : {};
  } catch {
    // Navigation privée, ou stockage refusé : la page marche quand même,
    // elle oublie simplement ce qui était déplié.
    return {};
  }
}

function écrireChoix(choix: Choix): void {
  try {
    localStorage.setItem(MÉMOIRE, JSON.stringify(choix));
  } catch {
    /* voir ci-dessus */
  }
}

/**
 * Une section qui ne montre qu'une ligne tant qu'on ne la demande pas.
 *
 * **Un écran qui déballe tout ne dit rien.** Le tableau de bord empile des
 * listes qu'on ne lit pas toutes le même jour : un vendeur regarde les
 * tickets du jour, un exploitant regarde les recettes du mois, et chacun
 * défile devant ce qui ne le concerne pas pour atteindre ce qui le concerne.
 * Replié, l'écran tient dans une hauteur d'écran et laisse choisir.
 *
 * **Le compte est sur la ligne repliée, et c'est tout l'intérêt.** Une
 * section fermée qui ne dit pas combien elle contient oblige à l'ouvrir pour
 * savoir s'il fallait l'ouvrir. « Tickets qui expirent · 3 » se lit sans
 * cliquer, et ne se clique que s'il y a trois.
 *
 * **Le choix est retenu d'une visite à l'autre.** Celui qui ouvre les mêmes
 * deux sections chaque matin ne doit pas les rouvrir chaque matin.
 *
 * `ouvertParDéfaut` existe pour ce qui ne se replie pas raisonnablement — la
 * ligne des recettes du jour, qu'on vient lire et rien d'autre.
 */
export function Section({
  id,
  titre,
  compte,
  ton = 'neutre',
  indice,
  actions,
  ouvertParDéfaut = false,
  children,
}: {
  /** Sous quel nom retenir l'état. Stable : il survit au libellé. */
  id: string;
  titre: string;
  /** Ce que la section contient, lisible sans l'ouvrir. */
  compte?: number;
  /** `alerte` quand le compte appelle un geste — un ticket qui expire. */
  ton?: 'neutre' | 'alerte';
  /** Une précision courte, à droite du titre. */
  indice?: ReactNode;
  /** Boutons de la section. Ils ne s'affichent qu'ouverte. */
  actions?: ReactNode;
  ouvertParDéfaut?: boolean;
  children: ReactNode;
}) {
  const [choix, setChoix] = useState<Choix | null>(null);
  const idContenu = `s${useId().replace(/:/g, '')}`;

  // Lu après le premier rendu : lire `localStorage` pendant le rendu ferait
  // diverger le serveur et le client si cette console était rendue côté
  // serveur un jour, et c'est de toute façon un effet de bord.
  useEffect(() => setChoix(lireChoix()), []);

  // **Le choix de l'exploitant prime, y compris quand il ferme ce qui
  // s'ouvrait tout seul.** `??` et non `||` : `false` est une décision, pas
  // une absence de décision.
  const ouvert = choix?.[id] ?? ouvertParDéfaut;

  function basculer() {
    const suite = { ...(choix ?? {}), [id]: !ouvert };
    setChoix(suite);
    écrireChoix(suite);
  }

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={basculer}
        aria-expanded={ouvert}
        aria-controls={idContenu}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <IconeChevron
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
            ouvert ? 'rotate-90' : ''
          }`}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{titre}</span>
        {indice && <span className="hidden shrink-0 text-xs text-slate-500 sm:block">{indice}</span>}
        {compte !== undefined && (
          // Le compte porte la couleur, pas le titre : un titre en rouge crie
          // une fois puis devient du décor, un nombre en rouge ne crie que
          // quand il n'est pas zéro.
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
              ton === 'alerte' && compte > 0
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {compte}
          </span>
        )}
      </button>

      {ouvert && (
        <div id={idContenu} className="border-t border-slate-200 p-4">
          {actions && <div className="mb-3 flex flex-wrap gap-2">{actions}</div>}
          {children}
        </div>
      )}
    </section>
  );
}
