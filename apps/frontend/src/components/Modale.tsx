import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Une fenêtre de formulaire, comme WinBox en ouvre.
 *
 * Les formulaires vivaient dépliés au milieu des écrans : acceptable à quatre
 * champs, plus du tout à quinze, et surtout ils poussaient la liste hors de
 * vue pendant qu'on saisissait. Une fenêtre garde la liste derrière, où l'on
 * peut la relire.
 *
 * `note` est rendue **en bas**, sous les boutons. C'est là qu'on lit ce
 * qu'un réglage implique une fois qu'on a vu les champs — la mettre en tête
 * revient à la faire sauter pour arriver au formulaire.
 */
export function Modale({
  titre,
  children,
  note,
  actions,
  onFermer,
  large = false,
}: {
  titre: string;
  children: ReactNode;
  /** La petite explication du bas. Facultative, mais presque toujours utile. */
  note?: ReactNode;
  /** Les boutons de validation. Annuler est fourni par la fenêtre. */
  actions?: ReactNode;
  onFermer: () => void;
  /** Pour les formulaires à plus d'une dizaine de champs. */
  large?: boolean;
}) {
  const panneau = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Échap ferme : c'est le réflexe de tout le monde, et sans lui une
    // fenêtre sans bouton visible piège l'utilisateur.
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFermer();
    };
    document.addEventListener('keydown', auClavier);

    // Le fond ne défile plus derrière la fenêtre : sur un téléphone, faire
    // défiler la page au lieu du formulaire est la première chose qui arrive.
    const débordement = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Le focus entre dans la fenêtre, sinon la tabulation continue de
    // parcourir la page cachée derrière.
    panneau.current?.focus();

    return () => {
      document.removeEventListener('keydown', auClavier);
      document.body.style.overflow = débordement;
    };
  }, [onFermer]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
      // Cliquer le fond ferme, mais seulement le fond : sans ce test, un
      // clic relâché hors d'un champ après une sélection de texte fermerait
      // la fenêtre et perdrait la saisie.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFermer();
      }}
    >
      <div
        ref={panneau}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        className={`w-full rounded-xl bg-white shadow-xl outline-none ${large ? 'max-w-4xl' : 'max-w-2xl'}`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{titre}</h2>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer"
            className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>

        <div className="rounded-b-xl border-t border-slate-200 bg-slate-50/70 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={onFermer}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Annuler
            </button>
          </div>
          {note && <div className="mt-3 max-w-3xl text-xs text-slate-500">{note}</div>}
        </div>
      </div>
    </div>
  );
}
