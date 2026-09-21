import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subscriptionsApi } from '../api/subscriptions';
import { customersApi } from '../api/customers';
import { plansApi } from '../api/plans';
import { useAuth } from '../auth/AuthContext';
import { libellé, STATUT_ABONNEMENT } from '../api/libelles';
import { ApiError } from '../api/client';
import { useState } from 'react';
import { MenuAction } from '../components/MenuAction';
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  PageHeader,
  PanneDeLecture,
  Table,
  TableSkeleton,
} from '../components/ui';

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
  /** L'abonnement sur lequel on agit : les gestes sont exclusifs. */
  const [actionSur, setActionSur] = useState<string | null>(null);

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
    // La fenêtre se referme ici : fermer au clic ferait lire « c'est fait »
    // sur un refus.
    onSuccess: () => { setError(null); setActionSur(null); refresh(); },
    onError,
  });
  const resume = useMutation({
    mutationFn: subscriptionsApi.resume,
    // La fenêtre se referme ici : fermer au clic ferait lire « c'est fait »
    // sur un refus.
    onSuccess: () => { setError(null); setActionSur(null); refresh(); },
    onError,
  });
  /**
   * Relit l'échéance sur le routeur. C'est lui qui fait autorité : il applique
   * l'expiration même cette console fermée, et la base peut avoir pris du
   * retard si quelqu'un a prolongé le compte depuis WinBox.
   */
  const reconcile = useMutation({
    mutationFn: subscriptionsApi.reconcile,
    onSuccess: () => {
      setActionSur(null);
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    },
  });

  const renew = useMutation({
    mutationFn: subscriptionsApi.renew,
    onSuccess: () => { setError(null); setActionSur(null); refresh(); },
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

      {actionSur &&
        (() => {
          const abo = subscriptions.data?.find((a) => a.id === actionSur);
          if (!abo) return null;
          const suspendu = abo.status === 'SUSPENDED';
          return (
            <MenuAction
              titre={`Abonnement de ${customerName(abo.customerId)}`}
              enCours={suspend.isPending || resume.isPending || renew.isPending}
              erreur={suspend.isError || resume.isError || renew.isError ? error : null}
              onFermer={() => {
                setError(null);
                setActionSur(null);
              }}
              options={[
                {
                  clé: 'relire',
                  libellé: 'Relire le routeur',
                  aide: "Ne change rien : va chercher l'échéance sur le routeur, qui fait autorité. À faire avant de décider, car la base a pu prendre du retard si quelqu'un a prolongé le compte depuis WinBox.",
                  libelléBouton: 'Relire maintenant',
                },
                {
                  clé: 'renouveler',
                  libellé: 'Renouveler',
                  aide: "Repousse l'échéance d'une période. À faire quand le client a payé — l'encaissement, lui, se déclare dans l'écran Paiements.",
                },
                suspendu
                  ? {
                      clé: 'reactiver',
                      libellé: 'Réactiver',
                      aide: "L'abonné retrouve son accès, avec l'échéance qu'il lui restait.",
                    }
                  : {
                      clé: 'suspendre',
                      libellé: 'Suspendre',
                      aide: "Coupe l'accès de l'abonné. L'abonnement et son historique restent : c'est réversible, contrairement à une suppression.",
                      danger: true,
                      libelléBouton: "Suspendre l'accès",
                    },
              ]}
              onAppliquer={(clé) => {
                setError(null);
                if (clé === 'relire') reconcile.mutate(actionSur);
                else if (clé === 'renouveler') renew.mutate(actionSur);
                else if (clé === 'suspendre') suspend.mutate(actionSur);
                else resume.mutate(actionSur);
              }}
            />
          );
        })()}

      {error && !actionSur && (
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
                  {/* Le bouton coupait l'accès d'un client payant sur un
                      seul clic, sans rien demander. Il ouvre maintenant la
                      même fenêtre que la liste : on y lit ce que le geste
                      fait avant de le faire. */}
                  {canWrite && recommendedAction === 'SUSPEND' && (
                    <Button
                      variant="secondary"
                      onClick={() => setActionSur(subscription.id)}
                    >
                      Action…
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
      ) : subscriptions.isError ? (
        <PanneDeLecture requête={subscriptions} quoi="les abonnements" />
      ) : (
        <Table head={['Compte', 'Client', 'Offre', 'Statut', 'Fin de période', '']}>
          {subscriptions.data?.map((subscription) => (
            <tr key={subscription.id}>
              <td className="px-3 py-2 font-mono">{subscription.hotspotUsername}</td>
              <td className="px-3 py-2">{customerName(subscription.customerId)}</td>
              <td className="px-3 py-2 text-slate-500">{planName(subscription.planId)}</td>
              <td className="px-3 py-2">
                <Badge tone={libellé(STATUT_ABONNEMENT, subscription.status).ton}>
                  {libellé(STATUT_ABONNEMENT, subscription.status).label}
                </Badge>
              </td>
              <td className="px-3 py-2">{formatDate(subscription.currentPeriodEnd)}</td>
              <td className="px-3 py-2 text-right">
                {/* Un seul bouton : c'est la fenêtre qui porte le choix, et
                    « Suspendre » n'y est plus à un pixel de « Renouveler ». */}
                {canWrite && (
                  <Button variant="secondary" onClick={() => setActionSur(subscription.id)}>
                    Action…
                  </Button>
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
