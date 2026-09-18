import type { ReactNode } from 'react';
import { APP_NAME, APP_TAGLINE, BrandLockup, BrandMark } from './Brand';

const HIGHLIGHTS = [
  {
    title: 'Tous vos routeurs au même endroit',
    body: "Plusieurs MikroTik, pilotés à distance depuis une seule console.",
  },
  {
    title: 'Des abonnements qui comptent en jours',
    body: "L'échéance vit dans le routeur : elle continue de s'appliquer même console fermée.",
  },
  {
    title: 'Mobile Money rattaché à vos puces',
    body: 'Chaque paiement retrouve son titulaire et son opérateur.',
  },
];

/**
 * Gabarit des écrans publics (connexion, inscription) : la marque à gauche,
 * le formulaire à droite. Sous `lg`, le panneau de marque cède la place à un
 * en-tête compact — un téléphone doit voir le formulaire sans défiler.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Les formulaires longs (inscription) ont besoin de deux colonnes. */
  wide?: boolean;
}) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,26rem)_1fr] xl:grid-cols-[minmax(0,30rem)_1fr]">
      <aside className="relative hidden overflow-hidden bg-slate-900 p-10 lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(120%_90%_at_10%_0%,#0ea5e9_0%,#0369a1_38%,#1e1b4b_100%)]"
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07] bg-[linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] bg-[size:36px_36px]"
        />

        <div className="relative">
          <BrandLockup tone="light" tagline={APP_TAGLINE} />
        </div>

        <div className="relative space-y-7">
          {HIGHLIGHTS.map((item) => (
            <div key={item.title} className="flex gap-3">
              <span
                aria-hidden
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-300 ring-4 ring-sky-300/20"
              />
              <div>
                <p className="text-sm font-medium text-white">{item.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-sky-100/70">{item.body}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="relative text-xs text-sky-100/50">
          {APP_NAME} — Toliara, Madagascar
        </p>
      </aside>

      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-sm'}`}>
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="h-9 w-9" />
            <div>
              <div className="text-lg font-semibold tracking-tight text-slate-900">{APP_NAME}</div>
              <div className="text-xs text-slate-500">{APP_TAGLINE}</div>
            </div>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}

          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}

/**
 * Message d'état d'un formulaire. Le ton distingue ce que l'utilisateur doit
 * corriger (`error`) de ce qu'il doit simplement attendre (`warning`, cas du
 * compte en attente d'activation) : lui montrer « identifiants invalides »
 * alors que son mot de passe est bon l'enverrait le changer pour rien.
 */
export function AuthNotice({ tone, children }: { tone: 'error' | 'warning'; children: ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-amber-200 bg-amber-50 text-amber-800';

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-sm ${styles}`} role="alert">
      {children}
    </div>
  );
}
