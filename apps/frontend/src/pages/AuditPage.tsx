import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ACTION_LABEL, auditApi, type AuditEntry, type AuditFilter } from '../api/audit';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  FormField,
  PageHeader,
  Select,
  Table,
  TableSkeleton,
} from '../components/ui';

/** Fenêtres proposées, du plus courant au plus large. */
const PÉRIODES = [
  { valeur: '', libellé: 'Depuis toujours' },
  { valeur: '1', libellé: "Dernières 24 heures" },
  { valeur: '7', libellé: '7 derniers jours' },
  { valeur: '30', libellé: '30 derniers jours' },
];

function depuis(jours: string): string | undefined {
  if (!jours) return undefined;
  return new Date(Date.now() - Number(jours) * 86_400_000).toISOString();
}

export function AuditPage() {
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [result, setResult] = useState('');
  const [période, setPériode] = useState('7');
  // Les pages déjà vues, pour pouvoir revenir en arrière sans tout recharger.
  const [curseurs, setCurseurs] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [détail, setDétail] = useState<AuditEntry | null>(null);

  const filtre: AuditFilter = {
    action: action || undefined,
    targetType: targetType || undefined,
    result: result || undefined,
    since: depuis(période),
    cursor: curseurs[page] ?? undefined,
  };

  const journal = useQuery({
    queryKey: ['audit', filtre],
    queryFn: () => auditApi.list(filtre),
  });
  const facettes = useQuery({ queryKey: ['audit-facets'], queryFn: auditApi.facets });

  /** Changer de filtre remet la pagination à zéro : le curseur ne vaut plus. */
  function filtrer(appliquer: () => void) {
    appliquer();
    setCurseurs([null]);
    setPage(0);
  }

  const entrées = journal.data?.entries ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal"
        description={
          <>
            Qui a fait quoi, quand, et depuis quelle adresse. Le journal est en lecture seule et
            ne s'efface pas : il survit à la suppression du compte qui a agi.
          </>
        }
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Action">
            <Select value={action} onChange={(e) => filtrer(() => setAction(e.target.value))}>
              <option value="">Toutes</option>
              {facettes.data?.actions.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a] ?? a}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Objet">
            <Select
              value={targetType}
              onChange={(e) => filtrer(() => setTargetType(e.target.value))}
            >
              <option value="">Tous</option>
              {facettes.data?.targetTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Issue">
            <Select value={result} onChange={(e) => filtrer(() => setResult(e.target.value))}>
              <option value="">Toutes</option>
              <option value="SUCCESS">Réussies</option>
              <option value="FAILURE">Échouées</option>
            </Select>
          </FormField>
          <FormField label="Période">
            <Select value={période} onChange={(e) => filtrer(() => setPériode(e.target.value))}>
              {PÉRIODES.map((p) => (
                <option key={p.valeur} value={p.valeur}>
                  {p.libellé}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      </Card>

      {journal.isError && (
        <ErrorNote onRetry={() => journal.refetch()}>
          Le journal n'a pas pu être lu.
        </ErrorNote>
      )}

      {journal.isPending ? (
        <TableSkeleton columns={5} />
      ) : entrées.length === 0 ? (
        <EmptyState
          title="Aucune trace sur cette période"
          hint={
            période
              ? "Élargissez la période, ou retirez les filtres : le journal ne garde que ce qui s'est produit."
              : "Rien n'a encore été enregistré pour cet exploitant."
          }
        />
      ) : (
        <Table head={['Quand', 'Action', 'Objet', 'Par', 'Issue']}>
          {entrées.map((entrée) => (
            <tr
              key={entrée.id}
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => setDétail(entrée)}
            >
              <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                {new Date(entrée.createdAt).toLocaleString('fr-FR')}
              </td>
              <td className="px-3 py-2 font-medium">
                {ACTION_LABEL[entrée.action] ?? entrée.action}
              </td>
              <td className="px-3 py-2">
                <span className="text-slate-600">{entrée.targetType}</span>
                {entrée.targetId && (
                  <span className="ml-1 font-mono text-xs text-slate-400">
                    {entrée.targetId.slice(0, 8)}
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                {/* Un compte supprimé laisse ses traces : le dire plutôt que
                    d'afficher une case vide. */}
                {entrée.adminUserName ?? <span className="text-slate-400">compte supprimé</span>}
              </td>
              <td className="px-3 py-2">
                <Badge tone={entrée.result === 'SUCCESS' ? 'green' : 'red'}>
                  {entrée.result === 'SUCCESS' ? 'réussie' : 'échouée'}
                </Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {(page > 0 || journal.data?.nextCursor) && (
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Précédent
          </Button>
          <span className="text-sm text-slate-500">Page {page + 1}</span>
          <Button
            variant="secondary"
            disabled={!journal.data?.nextCursor}
            onClick={() => {
              const suivant = journal.data?.nextCursor ?? null;
              setCurseurs((liste) => (liste[page + 1] ? liste : [...liste, suivant]));
              setPage((p) => p + 1);
            }}
          >
            Suivant
          </Button>
        </div>
      )}

      {détail && (
        <Card title={`${ACTION_LABEL[détail.action] ?? détail.action} — détail`}>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Quand">{new Date(détail.createdAt).toLocaleString('fr-FR')}</Field>
            <Field label="Par">{détail.adminUserName ?? 'compte supprimé'}</Field>
            <Field label="Adresse">{détail.ipAddress ?? '—'}</Field>
            <Field label="Routeur">{détail.routerLabel ?? '—'}</Field>
          </dl>
          {détail.payloadDiff != null && (
            <pre className="mt-3 max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
              {JSON.stringify(détail.payloadDiff, null, 2)}
            </pre>
          )}
          <div className="mt-3">
            <Button variant="secondary" onClick={() => setDétail(null)}>
              Fermer
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
