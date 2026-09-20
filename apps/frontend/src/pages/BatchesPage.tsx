import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { vouchersApi } from '../api/vouchers';
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  Table,
  TableSkeleton,
} from '../components/ui';

const ÉTAT_LOT: Record<string, { libellé: string; tone: 'green' | 'amber' | 'slate' | 'red' }> = {
  COMPLETED: { libellé: 'généré', tone: 'green' },
  PENDING: { libellé: 'en cours', tone: 'amber' },
  FAILED: { libellé: 'échoué', tone: 'red' },
};

/** Part vendue d'un lot, en pourcentage entier. */
function part(vendus: number, total: number): number {
  return total === 0 ? 0 : Math.round((vendus / total) * 100);
}

/**
 * Les lots générés, et ce qu'ils sont devenus.
 *
 * Les modèles existaient depuis le début sans qu'aucun écran ne les montre :
 * on générait cent tickets, et plus rien ne disait combien avaient été
 * vendus ni quel lot était déjà imprimé. « Ai-je encore des tickets 1 jour ? »
 * se répondait en comptant à la main dans la liste des tickets.
 */
export function BatchesPage() {
  const lots = useQuery({ queryKey: ['voucher-batches'], queryFn: vouchersApi.listBatches });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lots de tickets"
        description="Chaque génération laisse un lot. On y voit ce qui a été produit, par qui, et ce qu'il en reste à vendre."
        actions={
          <Link to="/vouchers">
            <Button variant="secondary">Générer un lot</Button>
          </Link>
        }
      />

      {lots.isError && (
        <ErrorNote onRetry={() => lots.refetch()}>Les lots n'ont pas pu être lus.</ErrorNote>
      )}

      {lots.isPending ? (
        <TableSkeleton columns={6} />
      ) : (lots.data ?? []).length === 0 ? (
        <EmptyState
          title="Aucun lot généré"
          hint="Un lot est créé à chaque génération de tickets. Générez-en un pour commencer à vendre."
          action={
            <Link to="/vouchers">
              <Button>Générer un lot</Button>
            </Link>
          }
        />
      ) : (
        <Table head={['Généré le', 'Offre', 'Routeur', 'Avancement', 'Restant', 'Par']}>
          {lots.data!.map((lot) => {
            const état = ÉTAT_LOT[lot.status] ?? { libellé: lot.status, tone: 'slate' as const };
            const pourcent = part(lot.decompte.vendus, lot.decompte.total);
            const épuisé = lot.decompte.disponibles === 0 && lot.decompte.total > 0;

            return (
              <tr key={lot.id}>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                  {new Date(lot.createdAt).toLocaleDateString('fr-FR')}
                  <span className="ml-2">
                    <Badge tone={état.tone}>{état.libellé}</Badge>
                  </span>
                  {/* Une génération interrompue a produit moins que demandé :
                      le dire ici, sinon l'écart ne s'explique nulle part. */}
                  {lot.job && lot.job.processed < lot.job.total && (
                    <div className="mt-0.5 text-xs text-amber-700">
                      {lot.job.processed} sur {lot.job.total} produits
                      {lot.job.errorMessage ? ` — ${lot.job.errorMessage}` : ''}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {lot.plan?.name ?? '—'}
                  {/* La planche est sur le routeur, pas ici : le chemin est la
                      seule chose qui permette d'aller la rechercher. */}
                  {(lot.planches?.length ?? 0) > 0 && (
                    <div className="mt-0.5 space-y-0.5 font-mono text-[11px] text-emerald-700">
                      {lot.planches!.map((chemin) => (
                        <div key={chemin}>{chemin}</div>
                      ))}
                    </div>
                  )}
                  {lot.prefix && (
                    <span className="ml-1 font-mono text-xs text-slate-400">{lot.prefix}…</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">{lot.router?.label ?? '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-sky-500 transition-all"
                        style={{ width: `${pourcent}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-xs text-slate-500">
                      {lot.decompte.vendus}/{lot.decompte.total}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`tabular-nums font-medium ${épuisé ? 'text-slate-400' : 'text-slate-900'}`}
                  >
                    {lot.decompte.disponibles}
                  </span>
                  {épuisé && <span className="ml-1 text-xs text-slate-400">épuisé</span>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {lot.createdByAdmin?.email ?? '—'}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
