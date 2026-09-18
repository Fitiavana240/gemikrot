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
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300',
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
