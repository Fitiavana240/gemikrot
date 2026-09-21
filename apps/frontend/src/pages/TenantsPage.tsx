import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tenantsApi, type TenantStatus } from '../api/tenants';
import { ApiError } from '../api/client';
import { Badge, Button, Card, PageHeader, Table, TableSkeleton } from '../components/ui';
import { Confirmation } from '../components/Edition';

/** Propres a cet ecran : « en attente » ne veut rien dire ailleurs. */
const STATUT_EXPLOITANT: Record<TenantStatus, { label: string; ton: 'green' | 'amber' | 'red' }> = {
  ACTIVE: { label: 'actif', ton: 'green' },
  PENDING: { label: 'en attente de validation', ton: 'amber' },
  SUSPENDED: { label: 'suspendu', ton: 'red' },
};

/** Réservé au SUPER_ADMIN : validation et suivi des exploitants. */
export function TenantsPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  /** L'exploitant qu'on s'apprête à suspendre, tant que ce n'est pas confirmé. */
  const [àSuspendre, setÀSuspendre] = useState<{ id: string; name: string } | null>(null);
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
    onSuccess: () => { setError(null); setÀSuspendre(null); refresh(); },
    onError,
  });

  const pending = tenants.data?.filter((t) => t.status === 'PENDING') ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exploitants"
        description="Les réseaux Wi-Fi hébergés par la plateforme. Un compte inscrit reste bloqué tant qu'il n'est pas activé ici."
      />

      {àSuspendre && (
        <Confirmation
          titre={`Suspendre l’exploitant « ${àSuspendre.name} » ?`}
          libelléConfirmer="Suspendre cet exploitant"
          enCours={suspend.isPending}
          erreur={suspend.isError ? error : null}
          onAnnuler={() => {
            setError(null);
            setÀSuspendre(null);
          }}
          onConfirmer={() => suspend.mutate(àSuspendre.id)}
        >
          Ses comptes ne pourront plus entrer dans la console. Ce n&apos;est pas une
          suppression : rien n&apos;est effacé et <strong>Activer</strong> rétablit tout.
        </Confirmation>
      )}

      {error && !àSuspendre && (
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
        <TableSkeleton columns={4} />
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
                <Badge tone={STATUT_EXPLOITANT[tenant.status].ton}>
                  {STATUT_EXPLOITANT[tenant.status].label}
                </Badge>
              </td>
              <td className="space-x-2 px-3 py-2 text-right">
                {tenant.status !== 'ACTIVE' ? (
                  <Button onClick={() => activate.mutate(tenant.id)}>Activer</Button>
                ) : (
                  // Un clic coupait tout un réseau : la console de
                  // l'exploitant et le service de ses clients.
                  <Button
                    variant="danger"
                    onClick={() => setÀSuspendre({ id: tenant.id, name: tenant.name })}
                  >
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
