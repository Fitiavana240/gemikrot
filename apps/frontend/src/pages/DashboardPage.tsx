import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { dashboardApi } from '../api/dashboard';
import { telephoneAffiche } from '../api/customers';
import { useCurrency } from '../api/money';
import { REACHABILITY_LABEL, routersApi } from '../api/routers';
import { useRouterSelection } from '../routers/RouterContext';
import { mikrotikApi } from '../api/mikrotik';
import { Stat, Gauge } from '../components/Stat';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  TableSkeleton,
} from '../components/ui';

const VOUCHER_LABEL: Record<string, string> = {
  CREATED: 'disponibles',
  SOLD: 'vendus',
  ACTIVE: 'en cours',
  EXPIRED: 'expirés',
  DISABLED: 'coupés',
  CANCELLED: 'annulés',
};

export function DashboardPage() {
  const { format } = useCurrency();
  const { current } = useRouterSelection();

  const resume = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboardApi.summary,
    refetchInterval: 30_000,
  });

  const routeurs = useQuery({ queryKey: ['routers'], queryFn: routersApi.list });

  // L'état système vient du routeur, pas de la base : il n'a de sens qu'en
  // direct, et on ne le demande que si un routeur est sélectionné.
  const systeme = useQuery({
    queryKey: ['router-status', current?.id],
    queryFn: () => mikrotikApi.status(current!.id),
    enabled: Boolean(current?.id),
    refetchInterval: 30_000,
    retry: false,
  });

  if (resume.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Vue d'ensemble" />
        <TableSkeleton columns={4} rows={2} />
      </div>
    );
  }

  if (resume.isError || !resume.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Vue d'ensemble" />
        <ErrorNote onRetry={() => resume.refetch()}>
          La vue d'ensemble n'a pas pu être chargée.
        </ErrorNote>
      </div>
    );
  }

  const d = resume.data;
  const injoignables = (routeurs.data ?? []).filter((r) => r.health.state !== 'JOIGNABLE');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vue d'ensemble"
        description="Ce qu'il faut savoir en ouvrant la console : ce qui est encaissé, ce qui reste à vendre, et ce qui demande une décision."
      />

      {/* Un routeur injoignable passe avant les chiffres : ils sont peut-être
          faux, et surtout plus rien ne s'écrit sur le matériel. */}
      {injoignables.length > 0 && (
        <ErrorNote>
          {injoignables.length === 1
            ? `Le routeur « ${injoignables[0].label} » est ${REACHABILITY_LABEL[injoignables[0].health.state].label}.`
            : `${injoignables.length} routeurs ne répondent pas.`}{' '}
          <Link to="/routers" className="underline">
            Voir les routeurs
          </Link>
        </ErrorNote>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Encaissé aujourd'hui" value={format(d.revenue.today)} to="/payments" />
        <Stat label="Cette semaine" value={format(d.revenue.thisWeek)} to="/payments" />
        <Stat label="Ce mois" value={format(d.revenue.thisMonth)} to="/payments" />
        <Stat
          label="En attente de validation"
          value={d.paiementsEnAttente}
          tone={d.paiementsEnAttente > 0 ? 'alerte' : 'neutre'}
          hint={d.paiementsEnAttente > 0 ? 'à vérifier' : undefined}
          to="/payments"
        />
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Connectés" value={d.connectedClients} hint="en ce moment" to="/sessions" />
        <Stat
          label="Tickets disponibles"
          value={d.ticketsDisponibles}
          tone={d.ticketsDisponibles === 0 ? 'alerte' : 'neutre'}
          hint={d.ticketsDisponibles === 0 ? 'plus rien à vendre' : 'prêts à vendre'}
          to="/vouchers"
        />
        <Stat label="Abonnés actifs" value={d.abonnesActifs} to="/subscriptions" />
        <Stat
          label="Échéances sous 7 jours"
          value={d.echeancesProches}
          tone={d.echeancesProches > 0 ? 'alerte' : 'bien'}
          hint={d.echeancesProches > 0 ? 'à relancer' : 'rien à relancer'}
          to="/subscriptions"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Routeur">
          {!current ? (
            <p className="text-sm text-slate-500">Aucun routeur sélectionné.</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <Field label="Nom">{current.label}</Field>
                <Field label="État">
                  <Badge tone={REACHABILITY_LABEL[current.health.state].tone}>
                    {REACHABILITY_LABEL[current.health.state].label}
                  </Badge>
                </Field>
                <Field label="Modèle">{systeme.data?.resource.boardName ?? '—'}</Field>
                <Field label="Actif depuis">{systeme.data?.resource.uptime ?? '—'}</Field>
              </dl>
              <div className="mt-4 space-y-2.5">
                <Gauge label="Processeur" value={systeme.data?.resource.cpuLoadPercent ?? null} />
                <Gauge
                  label="Mémoire"
                  value={
                    // Le routeur rend la memoire libre, pas l'occupee : la
                    // part utilisee se deduit, elle ne se lit pas.
                    systeme.data
                      ? ((systeme.data.resource.totalMemoryBytes -
                          systeme.data.resource.freeMemoryBytes) /
                          systeme.data.resource.totalMemoryBytes) *
                        100
                      : null
                  }
                />
              </div>
              <p className="mt-3 text-xs text-slate-400">
                RouterOS {systeme.data?.resource.version ?? '—'}
              </p>
              {systeme.isError && (
                <p className="mt-3 text-xs text-slate-400">
                  L'état système n'a pas pu être lu — le routeur ne répond pas.
                </p>
              )}
            </>
          )}
        </Card>

        <Card title="Tickets">
          {d.vouchersByStatus.length === 0 ? (
            <EmptyState
              title="Aucun ticket"
              hint="Générez un premier lot pour commencer à vendre."
              action={
                <Link to="/vouchers">
                  <Button>Générer des tickets</Button>
                </Link>
              }
            />
          ) : (
            <ul className="space-y-1.5 text-sm">
              {d.vouchersByStatus.map((v) => (
                <li key={v.status} className="flex justify-between">
                  <span className="text-slate-600">{VOUCHER_LABEL[v.status] ?? v.status}</span>
                  <span className="font-medium tabular-nums">{v._count._all}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Derniers paiements">
          {d.recentPayments.length === 0 ? (
            <p className="text-sm text-slate-400">Aucun paiement enregistré.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {d.recentPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-slate-500">{p.reference}</span>
                  <Badge
                    tone={
                      p.status === 'VERIFIED' ? 'green' : p.status === 'PENDING' ? 'amber' : 'red'
                    }
                  >
                    {p.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Derniers clients">
        {d.recentCustomers.length === 0 ? (
          <p className="text-sm text-slate-400">Aucun client enregistré.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {d.recentCustomers.map((c) => (
              <li key={c.id} className="flex justify-between py-1.5">
                <Link to={`/customers/${c.id}`} className="text-sky-700 hover:underline">
                  {c.name}
                </Link>
                <span
                  className={
                    telephoneAffiche(c.phone).provisoire
                      ? 'text-slate-400 italic'
                      : 'text-slate-500'
                  }
                >
                  {telephoneAffiche(c.phone).texte}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
