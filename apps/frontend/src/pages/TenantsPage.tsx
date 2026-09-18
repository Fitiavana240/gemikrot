import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tenantsApi, type TenantStatus } from '../api/tenants';
import { ApiError } from '../api/client';
import { Badge, Button, Card, Table } from '../components/ui';

const STATUS_TONE: Record<TenantStatus, 'green' | 'amber' | 'red'> = {
  ACTIVE: 'green',
  PENDING: 'amber',
  SUSPENDED: 'red',
};

/** Réservé au SUPER_ADMIN : validation et suivi des exploitants. */
export function TenantsPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: tenantsApi.list });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tenants'] });
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Erreur inconnue');

  const activate = useMutation({
    mutationFn: tenantsApi.activate,
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });
  const suspend = useMutation({
    mutationFn: tenantsApi.suspend,
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });

  const pending = tenants.data?.filter((t) => t.status === 'PENDING') ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Exploitants</h1>

      {error && (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      )}

      {pending.length > 0 && (
        <Card title={`${pending.length} inscription(s) en attente de votre validation`}>
          <p className="text-sm text-slate-600">
            Un exploitant en attente ne peut pas se connecter tant que vous ne l'avez pas activé.
          </p>
        </Card>
      )}

      {tenants.isLoading ? (
        <p className="text-slate-500">Chargement…</p>
      ) : (
        <Table head={['Exploitant', 'Réseau Wi-Fi', 'Devise', 'Domaines', 'Statut', '']}>
          {tenants.data?.map((tenant) => (
            <tr key={tenant.id}>
              <td className="px-3 py-2">{tenant.name}</td>
              <td className="px-3 py-2">{tenant.wifiName}</td>
              <td className="px-3 py-2">{tenant.currency}</td>
              <td className="px-3 py-2 text-xs text-slate-500">
                {tenant.domains.join(', ') || '—'}
              </td>
              <td className="px-3 py-2">
                <Badge tone={STATUS_TONE[tenant.status]}>{tenant.status}</Badge>
              </td>
              <td className="space-x-2 px-3 py-2 text-right">
                {tenant.status !== 'ACTIVE' ? (
                  <Button onClick={() => activate.mutate(tenant.id)}>Activer</Button>
                ) : (
                  <Button variant="danger" onClick={() => suspend.mutate(tenant.id)}>
                    Suspendre
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
