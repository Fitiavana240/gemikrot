import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Un chiffre et ce qu'il veut dire.
 *
 * Trois règles tirées de ce qui rate ailleurs. Le chiffre est gros et le
 * libellé petit, parce qu'on vient chercher le chiffre. Le libellé dit la
 * grandeur et non la table — « encaissé aujourd'hui », pas « paiements ».
 * Et une carte cliquable mène à l'écran qui détaille, sinon le chiffre
 * laisse l'utilisateur chercher lui-même d'où il sort.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutre',
  to,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  /** `alerte` pour ce qui demande une action, `neutre` pour ce qui informe. */
  tone?: 'neutre' | 'alerte' | 'bien';
  to?: string;
}) {
  const accent = {
    neutre: 'text-slate-900',
    alerte: 'text-amber-700',
    bien: 'text-emerald-700',
  }[tone];

  const contenu = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </>
  );

  const classes =
    'block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors';

  return to ? (
    <Link to={to} className={`${classes} hover:border-sky-300 hover:bg-sky-50/40`}>
      {contenu}
    </Link>
  ) : (
    <div className={classes}>{contenu}</div>
  );
}

/**
 * Jauge de pourcentage, pour ce que le routeur mesure.
 *
 * La barre passe à l'ambre puis au rouge parce qu'un pourcentage seul ne dit
 * pas s'il faut s'inquiéter : 80 % de mémoire sur un hAP n'a pas le même sens
 * que 80 % de stockage.
 */
export function Gauge({ label, value }: { label: string; value: number | null }) {
  const pourcent = value == null ? null : Math.max(0, Math.min(100, value));
  const couleur =
    pourcent == null
      ? 'bg-slate-200'
      : pourcent >= 90
        ? 'bg-red-500'
        : pourcent >= 70
          ? 'bg-amber-500'
          : 'bg-emerald-500';

  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="tabular-nums text-slate-700">
          {pourcent == null ? '—' : `${Math.round(pourcent)} %`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all ${couleur}`}
          style={{ width: `${pourcent ?? 0}%` }}
        />
      </div>
    </div>
  );
}
