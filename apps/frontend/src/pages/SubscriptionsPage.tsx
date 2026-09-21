import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subscriptionsApi } from '../api/subscriptions';
import { customersApi, lienWhatsapp } from '../api/customers';
import { tenantsApi } from '../api/tenants';
import { plansApi } from '../api/plans';
import { useAuth } from '../auth/AuthContext';
import { libellé, STATUT_ABONNEMENT } from '../api/libelles';
import { ApiError } from '../api/client';
import { useState } from 'react';
import { Confirmation } from '../components/Edition';
import { Modale } from '../components/Modale';
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  PageHeader,
  FormField,
  Input,
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
  /** Le geste demandé sur une ligne, tant qu'il n'est pas confirmé. */
  const [àConfirmer, setÀConfirmer] = useState<{
    geste: 'suspendre' | 'reactiver';
    id: string;
  } | null>(null);

  const subscriptions = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => subscriptionsApi.list(),
  });
  const recommendations = useQuery({
    queryKey: ['subscription-recommendations'],
    queryFn: subscriptionsApi.recommendations,
  });
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  // Même clé que l'écran Réglages : le cache est partagé, pas dupliqué. Le nom
  // du réseau entre dans le message — « votre accès arrive à échéance » sans
  // dire de quel réseau il s'agit ne veut rien dire pour qui en a deux.
  const exploitant = useQuery({ queryKey: ['tenant-me'], queryFn: tenantsApi.mine });
  /** Le client dont on s'apprête à corriger le numéro. */
  const [àJoindre, setÀJoindre] = useState<{ id: string; name: string } | null>(null);
  const [numéro, setNuméro] = useState('');
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
    onSuccess: () => { setError(null); setÀConfirmer(null); refresh(); },
    onError,
  });
  const resume = useMutation({
    mutationFn: subscriptionsApi.resume,
    // La fenêtre se referme ici : fermer au clic ferait lire « c'est fait »
    // sur un refus.
    onSuccess: () => { setError(null); setÀConfirmer(null); refresh(); },
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

  const clientDe = (id: string) => customers.data?.find((c) => c.id === id) ?? null;
  const customerName = (id: string) => clientDe(id)?.name ?? '—';

  /**
   * Poser le numéro d'un client depuis l'écran qui dit de le prévenir.
   *
   * L'application conseillait « prévenir le client » sans donner aucun moyen
   * de le faire, et pour cause : le routeur ne stocke aucun téléphone, donc
   * une fiche importée en porte un provisoire. Renvoyer vers la fiche client
   * pour revenir ensuite ferait perdre la liste qu'on était en train de
   * traiter.
   */
  const poserNuméro = useMutation({
    mutationFn: ({ id, phone }: { id: string; phone: string }) =>
      customersApi.update(id, { phone }),
    onSuccess: () => {
      setError(null);
      setÀJoindre(null);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erreur inconnue'),
  });

  /**
   * Le message qui part, écrit une fois pour toutes.
   *
   * Nominatif, daté, et il nomme le réseau : un avertissement qui ne dit pas
   * de quoi il parle se lit comme une arnaque, ce qui est exactement l'effet
   * inverse de celui recherché.
   */
  const messageRelance = (nom: string, fin: string) =>
    `Bonjour ${nom}, votre acces ${exploitant.data?.wifiName ?? 'Wi-Fi'} arrive a echeance le ${formatDate(fin)}. Passez renouveler avant cette date pour ne pas etre coupe. Merci !`;
  const planName = (id: string) => plans.data?.find((p) => p.id === id)?.name ?? '—';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Abonnements"
        description="Les accès au mois. L'échéance vient du routeur, qui l'applique même cette console fermée."
      />

      {àConfirmer && (
        <Confirmation
          titre={
            àConfirmer.geste === 'suspendre'
              ? 'Voulez-vous vraiment suspendre cet abonnement ?'
              : 'Voulez-vous vraiment réactiver cet abonnement ?'
          }
          enCours={suspend.isPending || resume.isPending}
          erreur={suspend.isError || resume.isError ? error : null}
          onAnnuler={() => {
            setError(null);
            setÀConfirmer(null);
          }}
          onConfirmer={() => {
            setError(null);
            if (àConfirmer.geste === 'suspendre') suspend.mutate(àConfirmer.id);
            else resume.mutate(àConfirmer.id);
          }}
        >
          {àConfirmer.geste === 'suspendre' ? (
            <>
              L&apos;accès du client est coupé. L&apos;abonnement et son historique restent :
              c&apos;est réversible, contrairement à une suppression.
            </>
          ) : (
            <>L&apos;abonné retrouve son accès, avec l&apos;échéance qu&apos;il lui restait.</>
          )}
        </Confirmation>
      )}

      {àJoindre && (
        <Modale
          titre={`Numéro de « ${àJoindre.name} »`}
          onFermer={() => setÀJoindre(null)}
          actions={
            <Button
              disabled={poserNuméro.isPending || numéro.trim() === ''}
              onClick={() => poserNuméro.mutate({ id: àJoindre.id, phone: numéro.trim() })}
            >
              {poserNuméro.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          }
          note={
            <>
              Le routeur ne stocke aucun téléphone : les fiches venues de
              l&apos;import portent un numéro provisoire, qui ressemble à un vrai dans la
              liste. Tant qu&apos;il n&apos;est pas corrigé, <strong>ce client ne peut être
              prévenu de rien</strong> — ni par WhatsApp aujourd&apos;hui, ni par SMS quand
              l&apos;envoi automatique existera.
            </>
          }
        >
          <FormField
            label="Téléphone"
            aide="Comme il se compose : 034 03 941 88, ou +261 34 03 941 88."
          >
            <Input
              value={numéro}
              placeholder="034 03 941 88"
              onChange={(e) => setNuméro(e.target.value)}
            />
          </FormField>
          {poserNuméro.isError && error && (
            <p className="mt-2 text-sm text-red-600">{error}</p>
          )}
        </Modale>
      )}

      {error && !àConfirmer && !àJoindre && (
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
                <td className="space-x-2 whitespace-nowrap px-3 py-2 text-right">
                  {/* Le bouton coupait l'accès d'un client payant sur un seul
                      clic, sans rien demander. */}
                  {canWrite && recommendedAction === 'SUSPEND' && (
                    <Button
                      variant="danger"
                      onClick={() =>
                        setÀConfirmer({ geste: 'suspendre', id: subscription.id })
                      }
                    >
                      Suspendre
                    </Button>
                  )}
                  {/* « Prévenir le client » était écrit dans la colonne d'à
                      côté, et rien ne permettait de le faire. L'avertissement
                      par SMS attend une passerelle qui n'existe pas ; WhatsApp
                      existe, et c'est par là que tout le monde écrit ici.
                      Quand le numéro est provisoire, le bouton demande le vrai
                      plutôt que d'ouvrir une discussion avec personne. */}
                  {canWrite &&
                    recommendedAction !== 'SUSPEND' &&
                    (() => {
                      const client = clientDe(subscription.customerId);
                      if (!client) return null;
                      const lien = lienWhatsapp(
                        client.phone,
                        messageRelance(client.name, subscription.currentPeriodEnd),
                      );
                      return lien ? (
                        <a
                          href={lien}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                        >
                          Prévenir sur WhatsApp
                        </a>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setError(null);
                            setNuméro('');
                            setÀJoindre({ id: client.id, name: client.name });
                          }}
                        >
                          Renseigner le numéro
                        </Button>
                      );
                    })()}
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
              <td className="space-x-2 px-3 py-2 text-right">
                {canWrite && (
                  <>
                    {/* Relire ne change rien sur le routeur : pas de question
                        à poser pour une lecture. */}
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
                      <Button
                        onClick={() =>
                          setÀConfirmer({ geste: 'reactiver', id: subscription.id })
                        }
                      >
                        Réactiver
                      </Button>
                    ) : (
                      <Button
                        variant="danger"
                        onClick={() =>
                          setÀConfirmer({ geste: 'suspendre', id: subscription.id })
                        }
                      >
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
