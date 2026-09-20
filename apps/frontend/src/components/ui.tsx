import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {title && <h3 className="mb-2 text-sm font-medium text-slate-500">{title}</h3>}
      {children}
    </div>
  );
}

/**
 * `md` est réservé aux écrans d'accès (connexion, inscription), où les
 * champs sont seuls à l'écran et méritent d'être confortables au doigt ;
 * `sm` reste la densité des écrans de travail, qui affichent des tableaux.
 */
type UiSize = 'sm' | 'md';

const FIELD_SIZE: Record<UiSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-3.5 py-2.5 text-sm',
};

const FIELD_BASE =
  'w-full rounded-lg border border-slate-300 bg-white text-slate-900 transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20';

export function Button({
  variant = 'primary',
  uiSize = 'sm',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  uiSize?: UiSize;
}) {
  const styles = {
    primary: 'bg-sky-600 text-white hover:bg-sky-700 disabled:bg-slate-300',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    // Contour plutôt qu'aplat : une action irréversible se répète sur
    // chaque ligne d'un tableau, et six cents boutons pleins rouges
    // cessent d'alerter tout en fatiguant l'œil. Le rouge reste, il ne
    // domine plus — et le geste garde sa confirmation.
    danger:
      'border border-red-300 bg-white text-red-700 hover:border-red-400 hover:bg-red-50 disabled:opacity-50',
  };
  const sizes: Record<UiSize, string> = {
    sm: 'rounded-md px-3 py-1.5 text-sm',
    md: 'rounded-lg px-4 py-2.5 text-sm',
  };
  return (
    <button
      className={`font-medium transition-colors disabled:cursor-not-allowed ${sizes[uiSize]} ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input({
  uiSize = 'sm',
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { uiSize?: UiSize }) {
  return <input {...props} className={`${FIELD_BASE} ${FIELD_SIZE[uiSize]} ${className}`} />;
}

export function Select({
  uiSize = 'sm',
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { uiSize?: UiSize }) {
  return <select {...props} className={`${FIELD_BASE} ${FIELD_SIZE[uiSize]} ${className}`} />;
}

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export function Badge({ tone, children }: { tone: 'green' | 'amber' | 'slate' | 'red'; children: ReactNode }) {
  const styles = {
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
    red: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[tone]}`}>{children}</span>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

/**
 * En-tête d'écran : titre, phrase d'explication, actions.
 *
 * La phrase n'est pas décorative. Un exploitant qui n'est pas informaticien
 * arrive sur un écran sans savoir ce qu'il y risque — dire en une ligne ce
 * que l'écran fait, et ce qu'il ne fait pas, évite la moitié des hésitations.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Ce qu'on montre quand il n'y a rien.
 *
 * Un tableau vide laisse l'utilisateur se demander s'il a mal cherché ou si
 * l'application est cassée. Dire « il n'y a rien, et voici pourquoi » est une
 * information, pas un aveu.
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * Attente d'un tableau, esquissée à la forme du contenu à venir.
 *
 * Un gabarit plutôt qu'un tournoyeur : l'œil garde la mise en page et ne
 * sursaute pas quand les données arrivent.
 */
export function TableSkeleton({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, ligne) => (
          <div key={ligne} className="flex gap-3 px-3 py-3">
            {Array.from({ length: columns }).map((__, colonne) => (
              <div
                key={colonne}
                className="h-4 flex-1 animate-pulse rounded bg-slate-100"
                style={{ animationDelay: `${(ligne * columns + colonne) * 40}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Une erreur, dite une fois et au même endroit sur tous les écrans. */
export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm text-red-700">{children}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

/** Étiquette et valeur, pour les fiches de détail. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-slate-800">{children}</dd>
    </div>
  );
}
