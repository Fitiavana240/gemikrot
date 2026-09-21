import { useId } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { BoutonColonnes, useColonnes } from './Colonnes';

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

/**
 * La largeur par défaut d'un champ, sauf si l'appelant en demande une autre.
 *
 * `FIELD_BASE` commence par `w-full`, et trois écrans passaient `w-auto` pour
 * dimensionner un filtre à son contenu. Sans effet : les deux classes ont la
 * même spécificité, et c'est l'ordre de la feuille de style qui tranche, pas
 * celui de l'attribut. Le défaut gagnait à chaque fois. Invisible dans une
 * cellule de tableau, qui contraint déjà la largeur — bien visible sur le
 * filtre du User Manager, où le champ poussait son étiquette à la ligne.
 */
function largeur(className: string): string {
  return /(^|\s)w-/.test(className) ? FIELD_BASE.replace('w-full ', '') : FIELD_BASE;
}

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
  return <input {...props} className={`${largeur(className)} ${FIELD_SIZE[uiSize]} ${className}`} />;
}

export function Select({
  uiSize = 'sm',
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { uiSize?: UiSize }) {
  return <select {...props} className={`${largeur(className)} ${FIELD_SIZE[uiSize]} ${className}`} />;
}

export function FormField({
  label,
  children,
  aide,
}: {
  label: string;
  children: ReactNode;
  /** Ce que le champ fait, sous le champ : l'aide se lit après, jamais avant. */
  aide?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {aide && <span className="mt-1 block text-xs text-slate-500">{aide}</span>}
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

/** En deçà, tout tient à l'écran : proposer de masquer n'apporte rien. */
const COLONNES_AVANT_SELECTEUR = 5;

/**
 * Une table, avec le choix des colonnes quand elle en a assez pour gêner.
 *
 * Les colonnes sont masquées **en CSS, par leur rang**, et non retirées du
 * rendu. C'est ce qui permet au réglage de valoir pour les quarante-huit
 * tables de la console sans toucher à une seule d'entre elles : chacune écrit
 * ses lignes à sa façon, avec ses `colSpan` et ses cellules composées, et
 * aucune n'a à savoir qu'une colonne est cachée.
 */
export function Table({
  head,
  children,
  colonnes,
}: {
  head: string[];
  children: ReactNode;
  /**
   * Sous quel nom retenir le choix. Par défaut, les libellés eux-mêmes.
   * `false` retire le sélecteur — pour une table de trois colonnes qui sert
   * de fiche plus que de liste.
   */
  colonnes?: string | false;
}) {
  const { masquées, cachées, basculer, toutMontrer, réglables } = useColonnes(
    head,
    colonnes === false ? undefined : colonnes,
  );
  // `useId` rend un identifiant contenant « : », que les sélecteurs CSS ne
  // savent pas viser sans échappement.
  const id = `t${useId().replace(/:/g, '')}`;
  const offert = colonnes !== false && head.length >= COLONNES_AVANT_SELECTEUR;

  return (
    <div className="space-y-1">
      {offert && (
        <div className="flex justify-end">
          <BoutonColonnes
            réglables={réglables}
            cachées={cachées}
            basculer={basculer}
            toutMontrer={toutMontrer}
          />
        </div>
      )}
      <div id={id} className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        {masquées.size > 0 && (
          <style>
            {[...masquées]
              .map(
                (rang) =>
                  `#${id} th:nth-child(${rang + 1}),#${id} td:nth-child(${rang + 1}){display:none}`,
              )
              .join('')}
          </style>
        )}
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {head.map((h, rang) => (
                // Deux colonnes d'actions sans titre cohabitent sur certains
                // écrans : le libellé seul ne fait pas une clé.
                <th
                  key={`${h}-${rang}`}
                  className="px-3 py-2 text-left font-medium text-slate-500"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">{children}</tbody>
        </table>
      </div>
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
/**
 * L'état vide d'une table, à l'intérieur de la table.
 *
 * `EmptyState` remplace une table ; celui-ci se glisse dedans, pour les cas
 * où l'en-tête doit rester — il dit quelles colonnes existent, ce qui répond
 * à la moitié de la question quand il n'y a rien à montrer.
 *
 * Il existe pour que les quatorze tables qui affichaient une ligne grise
 * alignée à gauche parlent la même langue que le reste : même ton, même
 * centrage, même poids.
 */
export function EmptyRow({
  colSpan,
  children,
  hint,
}: {
  colSpan: number;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-6 py-10 text-center">
        <p className="text-sm font-medium text-slate-700">{children}</p>
        {hint && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{hint}</p>}
      </td>
    </tr>
  );
}

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

/**
 * Échec de lecture des registres de la console — clients, paiements,
 * abonnements, offres, tickets.
 *
 * Sans ce bandeau, ces écrans affichaient une table vide : `data` reste vide
 * faute de réponse, et la ligne « aucun client » ne s'affiche pas non plus,
 * sa garde comparant `undefined` à zéro. La console **niait les registres de
 * l'entreprise** — zéro paiement, zéro abonné — pour un serveur qui redémarre.
 *
 * Distinct de la panne d'une table lue sur le routeur : ces données-là sont
 * en base, et ne pas pouvoir les lire ne dit rien de leur existence. D'où
 * l'insistance de la phrase, qui est ce qu'il faut entendre en premier.
 *
 * La tournure évite l'accord — « Impossible de lire les offres » comme « les
 * clients » — plutôt que de le confier à chaque appelant, où il finirait par
 * se tromper.
 */
export function PanneDeLecture({
  requête,
  quoi,
}: {
  requête: { refetch: () => unknown };
  /** Le complément tel qu'il se lit : « les paiements », « les offres ». */
  quoi: string;
}) {
  return (
    <ErrorNote onRetry={() => requête.refetch()}>
      Impossible de lire {quoi}. Ces données sont en base et n'ont pas bougé — c'est
      l'affichage qui manque, pas l'enregistrement.
    </ErrorNote>
  );
}

/**
 * Un décompte, affiché seulement s'il a été lu.
 *
 * « 0 compte(s) » était écrit sans condition, à côté d'une table en échec :
 * la longueur d'un tableau vide faute de réponse. Le routeur en portait 646, la caisse ses tickets.
 * C'est la même confusion que la table blanche, en pire — un chiffre a l'air
 * d'un constat.
 */
export function Compteur({
  requête,
  nombre,
  unité,
}: {
  requête: { isPending: boolean; isError: boolean };
  nombre: number;
  unité: string;
}) {
  if (requête.isPending) return null;
  const texte = requête.isError ? `${unité} : non lu` : `${nombre} ${unité}`;
  return <span className="shrink-0 text-sm text-slate-500">{texte}</span>;
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
