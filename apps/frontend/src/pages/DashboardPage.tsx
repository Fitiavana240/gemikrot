import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/dashboard';
import { useCurrency } from '../api/money';
import { Card } from '../components/ui';

export function DashboardPage() {
  const { format } = useCurrency();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboardApi.summary,
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="text-slate-500">Chargement…</p>;
  if (error || !data) return <p className="text-red-600">Impossible de charger le dashboard.</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card title="Clients connectés">
          <p className="text-2xl font-semibold">{data.connectedClients}</p>
        </Card>
        <Card title="Revenus aujourd'hui">
          <p className="text-2xl font-semibold">{format(data.revenue.today)}</p>
        </Card>
        <Card title="Revenus cette semaine">
          <p className="text-2xl font-semibold">{format(data.revenue.thisWeek)}</p>
        </Card>
        <Card title="Revenus ce mois">
          <p className="text-2xl font-semibold">{format(data.revenue.thisMonth)}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Vouchers par statut">
          <ul className="space-y-1 text-sm">
            {data.vouchersByStatus.map((v) => (
              <li key={v.status} className="flex justify-between">
                <span>{v.status}</span>
                <span className="font-medium">{v._count._all}</span>
              </li>
            ))}
            {data.vouchersByStatus.length === 0 && <li className="text-slate-400">Aucun voucher pour l'instant.</li>}
          </ul>
        </Card>

        <Card title="Paiements récents">
          <ul className="space-y-1 text-sm">
            {data.recentPayments.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>
                  {p.reference} ({p.method})
                </span>
                <span className="font-medium">{p.status}</span>
              </li>
            ))}
            {data.recentPayments.length === 0 && <li className="text-slate-400">Aucun paiement pour l'instant.</li>}
          </ul>
        </Card>
      </div>

      <Card title="Clients récents">
        <ul className="space-y-1 text-sm">
          {data.recentCustomers.map((c) => (
            <li key={c.id} className="flex justify-between">
              <span>{c.name}</span>
              <span className="text-slate-500">{c.phone}</span>
            </li>
          ))}
          {data.recentCustomers.length === 0 && <li className="text-slate-400">Aucun client pour l'instant.</li>}
        </ul>
      </Card>
    </div>
  );
}
