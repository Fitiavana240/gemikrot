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
  libelléAnnuler = 'Annuler',
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
  /** « Annuler » pour un formulaire, « Non » pour une question fermée. */
  libelléAnnuler?: string;
}) {
  const panneau = useRef<HTMLDivElement>(null);

  /**
   * `onFermer` derrière une référence, et la raison est un vrai défaut vécu.
   *
   * Les appelants écrivent `onFermer={() => setCréer(false)}` : une fonction
   * neuve à chaque rendu. Un effet qui en dépend se démonte et se remonte
   * donc à **chaque frappe** — et comme il posait le focus sur le panneau, le
   * curseur quittait le champ après chaque lettre. Le champ gardait le texte,
   * mais il fallait recliquer dedans pour écrire la suivante.
   *
   * La référence garde la fonction à jour sans que rien n'en dépende.
   */
  const fermer = useRef(onFermer);
  fermer.current = onFermer;

  useEffect(() => {
    // Échap ferme : c'est le réflexe de tout le monde, et sans lui une
    // fenêtre sans bouton visible piège l'utilisateur.
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fermer.current();
    };
    document.addEventListener('keydown', auClavier);

    // Le fond ne défile plus derrière la fenêtre : sur un téléphone, faire
    // défiler la page au lieu du formulaire est la première chose qui arrive.
    //
    // La valeur d'avant est relevée une seule fois. Quand l'effet se rejouait
    // à chaque frappe, il relevait `hidden` — la sienne — et la « restaurait »
    // à la fermeture : la page entière ne défilait plus ensuite.
    const débordement = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Le focus entre dans la fenêtre, sinon la tabulation continue de
    // parcourir la page cachée derrière. Une seule fois, à l'ouverture :
    // c'est tout le propos de cet effet sans dépendances.
    //
    // Dans le premier champ, et non sur le panneau : on ouvre une fenêtre
    // pour y écrire. Prendre le panneau obligeait à un clic de plus, et
    // écrasait l'`autoFocus` que certains formulaires posent eux-mêmes.
    // Un champ de saisie, jamais une liste déroulante : une frappe dans une
    // liste qui a le focus en change la valeur en silence, sans curseur pour
    // le montrer. Quand le premier champ est une liste, le focus reste sur le
    // panneau et la tabulation l'atteint aussitôt.
    const cadre = panneau.current;
    if (cadre && !cadre.contains(document.activeElement)) {
      const premier = cadre.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]), textarea:not([disabled])',
      );
      (premier ?? cadre).focus();
      // Un champ déjà rempli voit son contenu sélectionné : sans cela le
      // curseur se pose à la fin, et taper « 25 » dans une quantité qui vaut
      // « 10 » donne « 1025 ». Constaté à l'essai.
      if (premier instanceof HTMLInputElement && premier.value !== '') {
        try {
          premier.select();
        } catch {
          // `select()` lève sur les types qui n'ont pas de sélection
          // (`number` selon les navigateurs). Le focus, lui, est acquis.
        }
      }
    }

    return () => {
      document.removeEventListener('keydown', auClavier);
      document.body.style.overflow = débordement;
    };
  }, []);

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
              {libelléAnnuler}
            </button>
          </div>
          {note && <div className="mt-3 max-w-3xl text-xs text-slate-500">{note}</div>}
        </div>
      </div>
    </div>
  );
}
