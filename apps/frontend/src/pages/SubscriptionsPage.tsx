import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subscriptionsApi, type SubscriptionStatus } from '../api/subscriptions';
import { customersApi } from '../api/customers';
import { plansApi } from '../api/plans';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  PageHeader,
  Table,
  TableSkeleton,
} from '../components/ui';

const STATUS_TONE: Record<SubscriptionStatus, 'green' | 'amber' | 'slate' | 'red'> = {
  ACTIVE: 'green',
  GRACE: 'amber',
  SUSPENDED: 'red',
  CANCELLED: 'slate',
};

const REASON_LABEL = {
  EXPIRING_SOON: 'Expire bientôt',
  IN_GRACE: 'En période de grâce',
  GRACE_ENDED: 'Grâce terminée',
} as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR');
}

export function SubscriptionsPage() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const subscriptions = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => subscriptionsApi.list(),
  });
  const recommendations = useQuery({
    queryKey: ['subscription-recommendations'],
    queryFn: subscriptionsApi.recommendations,
  });
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  const plans = useQuery({ queryKey: ['plans'], queryFn: plansApi.list });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    queryClient.invalidateQueries({ queryKey: ['subscription-recommendations'] });
  }

  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Erreur inconnue');

  const suspend = useMutation({
    mutationFn: subscriptionsApi.suspend,
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });
  const resume = useMutation({
    mutationFn: subscriptionsApi.resume,
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });
  /**
   * Relit l'échéance sur le routeur. C'est lui qui fait autorité : il applique
   * l'expiration même cette console fermée, et la base peut avoir pris du
   * retard si quelqu'un a prolongé le compte depuis WinBox.
   */
  const reconcile = useMutation({
    mutationFn: subscriptionsApi.reconcile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
  });

  const renew = useMutation({
    mutationFn: subscriptionsApi.renew,
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });

  const customerName = (id: string) => customers.data?.find((c) => c.id === id)?.name ?? '—';
  const planName = (id: string) => plans.data?.find((p) => p.id === id)?.name ?? '—';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Abonnements"
        description="Les accès au mois. L'échéance vient du routeur, qui l'applique même cette console fermée."
      />

      {error && (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      )}

      {recommendations.data && recommendations.data.length > 0 && (
        <Card title="À traiter — l'application recommande, vous décidez">
          <Table head={['Compte', 'Client', 'Situation', 'Jours restants', 'Action conseillée', '']}>
            {recommendations.data.map(({ subscription, daysRemaining, reason, recommendedAction }) => (
              <tr key={subscription.id}>
                <td className="px-3 py-2 font-mono">{subscription.hotspotUsername}</td>
                <td className="px-3 py-2">{customerName(subscription.customerId)}</td>
                <td className="px-3 py-2">
                  <Badge tone={reason === 'GRACE_ENDED' ? 'red' : 'amber'}>
                    {REASON_LABEL[reason]}
                  </Badge>
                </td>
                <td className="px-3 py-2">{daysRemaining}</td>
                <td className="px-3 py-2 text-slate-600">
                  {recommendedAction === 'SUSPEND' ? 'Suspendre' : 'Prévenir le client'}
                </td>
                <td className="px-3 py-2 text-right">
                  {canWrite && recommendedAction === 'SUSPEND' && (
                    <Button variant="danger" onClick={() => suspend.mutate(subscription.id)}>
                      Suspendre
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {subscriptions.isLoading ? (
        <TableSkeleton columns={4} />
      ) : (
        <Table head={['Compte', 'Client', 'Offre', 'Statut', 'Fin de période', '']}>
          {subscriptions.data?.map((subscription) => (
            <tr key={subscription.id}>
              <td className="px-3 py-2 font-mono">{subscription.hotspotUsername}</td>
              <td className="px-3 py-2">{customerName(subscription.customerId)}</td>
              <td className="px-3 py-2 text-slate-500">{planName(subscription.planId)}</td>
              <td className="px-3 py-2">
                <Badge tone={STATUS_TONE[subscription.status]}>{subscription.status}</Badge>
              </td>
              <td className="px-3 py-2">{formatDate(subscription.currentPeriodEnd)}</td>
              <td className="space-x-2 px-3 py-2 text-right">
                {canWrite && (
                  <>
                    {/* Relire avant de décider : la base peut avoir pris du
                        retard si quelqu'un a prolongé le compte depuis WinBox. */}
                    <Button
                      variant="secondary"
                      disabled={reconcile.isPending}
                      onClick={() => reconcile.mutate(subscription.id)}
                    >
                      {reconcile.isPending ? 'Lecture…' : 'Relire le routeur'}
                    </Button>
                    <Button variant="secondary" onClick={() => renew.mutate(subscription.id)}>
                      Renouveler
                    </Button>
                    {subscription.status === 'SUSPENDED' ? (
                      <Button onClick={() => resume.mutate(subscription.id)}>Réactiver</Button>
                    ) : (
                      <Button variant="danger" onClick={() => suspend.mutate(subscription.id)}>
                        Suspendre
                      </Button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
          {subscriptions.data?.length === 0 && (
            <EmptyRow colSpan={6} hint="Lancer l'import depuis l'écran Routeurs.">
              Aucun abonnement
            </EmptyRow>
          )}
        </Table>
      )}
    </div>
  );
}
