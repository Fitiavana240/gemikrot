import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { dashboardApi } from '../api/dashboard';
import { PAYMENT_STATUS } from '../api/payments';
import { telephoneAffiche } from '../api/customers';
import { useCurrency } from '../api/money';
import { REACHABILITY_LABEL, routersApi } from '../api/routers';
import { useRouterSelection } from '../routers/RouterContext';
import { mikrotikApi } from '../api/mikrotik';
import { hotspotApi } from '../api/hotspot';
import { tenantsApi } from '../api/tenants';
import { schedulingApi } from '../api/scheduling';
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
import { Occupation } from '../components/Occupation';

const VOUCHER_LABEL: Record<string, string> = {
  CREATED: 'disponibles',
  SOLD: 'vendus',
  ACTIVE: 'en cours',
  EXPIRED: 'expirés',
  DISABLED: 'coupés',
  CANCELLED: 'annulés',
};

/**
 * « depuis aujourd'hui », « depuis hier », « depuis 3 jours ».
 *
 * Un paiement en attente est un client qui a payé et n'a rien reçu : ce qui
 * compte n'est pas combien il y en a, mais depuis quand le premier attend.
 */
function anciennete(iso: string): string {
  const jours = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (jours <= 0) return "depuis aujourd'hui";
  if (jours === 1) return 'depuis hier';
  return `depuis ${jours} jours`;
}

export function DashboardPage() {
  const { format } = useCurrency();
  const { current, currentId } = useRouterSelection();

  const resume = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboardApi.summary,
    refetchInterval: 30_000,
  });

  const routeurs = useQuery({ queryKey: ['routers'], queryFn: routersApi.list });
  /**
   * Même clé que l'écran Réglages : le cache est partagé, pas dupliqué.
   *
   * Sans puce Mobile Money enregistrée, la page publique n'a aucun numéro à
   * montrer et ne peut donc rien encaisser. Réglages le disait déjà — mais il
   * faut y aller pour le lire, et c'est le tableau de bord qu'on ouvre le
   * matin. Relevé en production : zéro puce, quatre offres en vitrine.
   */
  const exploitant = useQuery({ queryKey: ['tenant-me'], queryFn: tenantsApi.mine });
  const sansEncaissement = (exploitant.data?.mobileMoneyAccounts?.length ?? 0) === 0;
  /**
   * Ce que l'ordonnanceur ferait s'il tournait.
   *
   * Lu seulement quand il est éteint : c'est là que la question se pose. Deux
   * requêtes sur la base, aucune sur le routeur.
   */
  const apercu = useQuery({
    queryKey: ['scheduling-apercu'],
    queryFn: schedulingApi.apercu,
    enabled: resume.data?.ordonnanceurActif === false,
    retry: false,
  });
  /**
   * Lu séparément du résumé, exprès.
   *
   * Les deux nombres viennent de deux sources qui n'ont pas les mêmes pannes :
   * le résumé vient de la base, le stock du routeur. Les mêler dans un appel
   * ferait perdre tout le tableau de bord dès qu'un câble tombe.
   */
  const stock = useQuery({
    queryKey: ['hotspot-stock', currentId],
    queryFn: () => hotspotApi.stock(currentId),
    retry: false,
  });

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
            ? `Le routeur « ${injoignables[0].label} » ${REACHABILITY_LABEL[injoignables[0].health.state].phrase}.`
            : `${injoignables.length} routeurs ne répondent pas.`}{' '}
          <Link to="/routers" className="underline">
            Voir les routeurs
          </Link>
        </ErrorNote>
      )}

      {/* Au-dessus de tout le reste : ce bandeau change la lecture de chaque
          chiffre en dessous. « Échéances sous 7 jours » n'est un compte à
          rebours que si quelque chose agit à l'échéance. */}
      {d.ordonnanceurActif === false && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Rien n&apos;expire tout seul sur ce serveur.</strong> Les travaux de fond
          sont désactivés : un ticket arrivé à échéance n&apos;est pas marqué, son accès
          n&apos;est pas coupé, et un abonné hors tolérance reste connecté.{' '}
          <strong>Tant que c&apos;est le cas, chaque échéance demande un geste</strong> —
          l&apos;onglet <em>Vérifier sur le routeur</em> des Tickets et le bouton
          <em> Suspendre</em> des Abonnements font le travail à la main. Pour les activer,
          il faut poser <span className="font-mono text-xs">SCHEDULER_ENABLED=&quot;true&quot;</span>{' '}
          dans la configuration du serveur, puis le redémarrer.
          {/* La question qu'on se pose avant d'allumer : qu'est-ce que cela
              coupe tout de suite ? Sans la réponse, on n'allume jamais. */}
          {apercu.data && (
            <p className="mt-2">
              {apercu.data.ticketsAExpirer.length === 0 &&
              apercu.data.abonnesASuspendre.length === 0 ? (
                <>
                  <strong>Les activer maintenant ne couperait rien</strong> : aucun ticket
                  n&apos;a dépassé son échéance et aucun abonné n&apos;est hors tolérance.
                </>
              ) : (
                <>
                  <strong>
                    Les activer maintenant couperait{' '}
                    {apercu.data.ticketsAExpirer.length > 0 &&
                      `${apercu.data.ticketsAExpirer.length} ticket(s)`}
                    {apercu.data.ticketsAExpirer.length > 0 &&
                      apercu.data.abonnesASuspendre.length > 0 &&
                      ' et '}
                    {apercu.data.abonnesASuspendre.length > 0 &&
                      `${apercu.data.abonnesASuspendre.length} abonné(s)`}
                    , dès la minute suivante.
                  </strong>{' '}
                  {[
                    ...apercu.data.ticketsAExpirer.map((t) => t.code),
                    ...apercu.data.abonnesASuspendre.map((a) => a.username),
                  ]
                    .slice(0, 8)
                    .join(', ')}
                  {apercu.data.ticketsAExpirer.length + apercu.data.abonnesASuspendre.length > 8 &&
                    '…'}
                </>
              )}
            </p>
          )}
        </div>
      )}

      {/* Placé au-dessus des recettes, parce que c'est d'elles qu'il parle :
          la page publique montre les offres et leurs prix, et n'a aucun
          numéro à donner. Le client va jusqu'à l'écran de paiement pour n'y
          trouver rien. */}
      {sansEncaissement && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>La page publique ne peut encaisser aucun paiement.</strong> Aucune puce
          Mobile Money n&apos;est enregistrée : vos clients voient les offres et leurs prix,
          puis un écran qui n&apos;a aucun numéro à leur donner.{' '}
          <Link to="/settings" className="font-medium underline">
            Enregistrer une puce
          </Link>
          .
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Encaissé aujourd'hui" value={format(d.revenue.today)} to="/payments" />
        <Stat label="Cette semaine" value={format(d.revenue.thisWeek)} to="/payments" />
        <Stat label="Ce mois" value={format(d.revenue.thisMonth)} to="/payments" />
        <Stat
          label="En attente de validation"
          value={d.paiementsEnAttente}
          tone={d.paiementsEnAttente > 0 ? 'alerte' : 'neutre'}
          hint={
            d.paiementsEnAttente > 0
              ? d.paiementEnAttenteDepuis
                ? `le plus ancien ${anciennete(d.paiementEnAttenteDepuis)}`
                : 'à vérifier'
              : undefined
          }
          to="/payments"
        />
      </section>

      {/* Cinq tuiles depuis que le stock du routeur est dit à part : sur
          quatre colonnes, la dernière tombait seule à la ligne. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Connectés" value={d.connectedClients} hint="en ce moment" to="/sessions" />
        {/* Deux nombres, et non un.
            « Tickets disponibles » ne comptait que ce que l'application a
            créé, sous un titre qui promet « ce qui reste à vendre ». Relevé sur
            ce parc : 10 annoncés, **602 en stock sur le routeur**. L'exploitant
            lisait le soixantième de son propre tiroir.
            Ils restent côte à côte et jamais additionnés : un ticket imprimé et
            perdu compte dans l'un et pas dans l'autre. */}
        <Stat
          label="Tickets suivis ici"
          value={d.ticketsDisponibles}
          tone={d.ticketsDisponibles === 0 ? 'alerte' : 'neutre'}
          // « Prêts à vendre » était une promesse que la base ne peut pas
          // tenir : elle ignore si le compte existe encore sur le routeur.
          // Relevé ici — les quinze l'étaient tous, et aucun n'ouvrait quoi
          // que ce soit, leurs comptes ayant été supprimés depuis WinBox.
          // L'onglet « Vérifier sur le routeur » est le seul à savoir.
          hint={
            d.ticketsDisponibles === 0
              ? "aucun créé dans l'application"
              : 'à vérifier sur le routeur'
          }
          to="/vouchers/rapprochement"
        />
        <Stat
          label="En stock sur le routeur"
          value={
            stock.isPending ? '…' : stock.isError ? 'non lu' : stock.data!.jamaisUtilises
          }
          hint={
            // « Ne répond pas » serait faux quand le routeur répond et refuse :
            // le bandeau du haut nomme déjà la cause exacte, cette tuile n'a qu'à
            // dire que le chiffre n'a pas pu être lu.
            stock.isError
              ? 'lecture impossible'
              : stock.data
                ? `comptes jamais utilisés sur ${stock.data.total}`
                : undefined
          }
          to="/hotspot/comptes"
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

        <Occupation />

      <Card title="Derniers paiements">
          {d.recentPayments.length === 0 ? (
            <p className="text-sm text-slate-400">Aucun paiement enregistré.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {d.recentPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-slate-500">{p.reference}</span>
                  {/* Le ton suit désormais le statut réel : « annulé » et
                      « remboursé » passaient en rouge comme un refus, alors
                      qu'ils ne demandent rien à personne. */}
                  <Badge tone={PAYMENT_STATUS[p.status].tone}>
                    {PAYMENT_STATUS[p.status].label}
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
