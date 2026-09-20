import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { customersApi, telephoneAffiche } from '../api/customers';
import { formatMoney } from '../api/money';
import {
  libellé,
  méthodePaiement,
  STATUT_ABONNEMENT,
  STATUT_PAIEMENT,
  STATUT_TICKET,
} from '../api/libelles';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  Table,
  TableSkeleton,
} from '../components/ui';

function date(valeur: string | null | undefined): string {
  return valeur ? new Date(valeur).toLocaleDateString('fr-FR') : '—';
}

/**
 * Tout ce qui concerne un client, sur un écran.
 *
 * La question posée au comptoir est presque toujours la même — « ce client
 * a-t-il payé, et jusqu'à quand a-t-il accès ? ». Y répondre demandait
 * d'ouvrir cinq écrans et de retenir le nom entre chaque. Ici la réponse est
 * visible sans défiler : l'accès en cours est en haut, le reste documente.
 */
export function CustomerSheetPage() {
  const { id = '' } = useParams();
  const fiche = useQuery({
    queryKey: ['customer-sheet', id],
    queryFn: () => customersApi.fiche(id),
    enabled: Boolean(id),
  });

  if (fiche.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Fiche client" />
        <TableSkeleton columns={4} rows={3} />
      </div>
    );
  }

  if (fiche.isError || !fiche.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Fiche client" />
        <ErrorNote onRetry={() => fiche.refetch()}>Ce client n'a pas pu être lu.</ErrorNote>
      </div>
    );
  }

  const { client, tickets, abonnements, appareils, paiements } = fiche.data;

  // Ce qui donne l'accès en ce moment : l'abonnement actif s'il y en a un,
  // sinon le ticket encore valide. C'est la seule chose qu'on cherche vraiment.
  const abonnementEnCours = abonnements.find((a) => a.status === 'ACTIVE' || a.status === 'GRACE');
  const ticketEnCours = tickets.find((t) => t.status === 'ACTIVE' || t.status === 'SOLD');

  return (
    <div className="space-y-6">
      <PageHeader
        title={client.name}
        description={`${telephoneAffiche(client.phone).texte}${client.email ? ` · ${client.email}` : ''}`}
        actions={
          <Link to="/customers">
            <Button variant="secondary">Retour au répertoire</Button>
          </Link>
        }
      />

      <Card title="Accès en cours">
        {abonnementEnCours ? (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Type">Abonnement</Field>
            <Field label="Offre">{abonnementEnCours.plan?.name ?? '—'}</Field>
            <Field label="Jusqu'au">{date(abonnementEnCours.currentPeriodEnd)}</Field>
            <Field label="État">
              <Badge tone={libellé(STATUT_ABONNEMENT, abonnementEnCours.status).ton}>
                {libellé(STATUT_ABONNEMENT, abonnementEnCours.status).label}
              </Badge>
            </Field>
          </dl>
        ) : ticketEnCours ? (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Type">Ticket</Field>
            <Field label="Code">
              <span className="font-mono">{ticketEnCours.code}</span>
            </Field>
            <Field label="Expire le">{date(ticketEnCours.expiresAt)}</Field>
            <Field label="État">
              <Badge tone={libellé(STATUT_TICKET, ticketEnCours.status).ton}>
                {libellé(STATUT_TICKET, ticketEnCours.status).label}
              </Badge>
            </Field>
          </dl>
        ) : (
          // Dire « aucun accès » explicitement : une carte vide laisserait
          // croire à un écran qui n'a pas fini de charger.
          <p className="text-sm text-slate-500">
            Aucun accès en cours. Ce client n'a ni abonnement actif ni ticket valide.
          </p>
        )}
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-700">Tickets</h2>
        {tickets.length === 0 ? (
          <EmptyState title="Aucun ticket" hint="Ce client n'a jamais acheté de ticket." />
        ) : (
          <Table head={['Code', 'Offre', 'État', 'Expire le']}>
            {tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td className="px-3 py-2 font-mono text-xs">{ticket.code}</td>
                <td className="px-3 py-2">{ticket.plan?.name ?? '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={libellé(STATUT_TICKET, ticket.status).ton}>
                    {libellé(STATUT_TICKET, ticket.status).label}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-slate-500">{date(ticket.expiresAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-700">Abonnements</h2>
        {abonnements.length === 0 ? (
          <EmptyState title="Aucun abonnement" />
        ) : (
          <Table head={['Compte', 'Offre', 'État', 'Échéance', 'Tolérance']}>
            {abonnements.map((abo) => (
              <tr key={abo.id}>
                <td className="px-3 py-2 font-mono text-xs">{abo.hotspotUsername}</td>
                <td className="px-3 py-2">{abo.plan?.name ?? '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={libellé(STATUT_ABONNEMENT, abo.status).ton}>
                    {libellé(STATUT_ABONNEMENT, abo.status).label}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-slate-500">{date(abo.currentPeriodEnd)}</td>
                <td className="px-3 py-2 text-slate-500">{date(abo.graceEndsAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-700">Appareils</h2>
        {appareils.length === 0 ? (
          <EmptyState
            title="Aucun appareil"
            hint="Les appareils apparaissent après une première connexion, ou lors d'un contournement du portail."
          />
        ) : (
          <Table head={['Adresse MAC', 'Nom', 'Type', 'Contournement', 'Vu le']}>
            {appareils.map((appareil) => (
              <tr key={appareil.id}>
                <td className="px-3 py-2 font-mono text-xs">{appareil.macAddress}</td>
                <td className="px-3 py-2">{appareil.hostname ?? '—'}</td>
                <td className="px-3 py-2 text-slate-500">{appareil.type}</td>
                <td className="px-3 py-2">
                  <Badge tone={appareil.bypassEnabled ? 'green' : 'slate'}>
                    {appareil.bypassEnabled ? 'actif' : 'non'}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-slate-500">{date(appareil.lastSeenAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-700">Paiements</h2>
        {paiements.length === 0 ? (
          <EmptyState title="Aucun paiement enregistré" />
        ) : (
          <Table head={['Date', 'Montant', 'Moyen', 'État', 'Référence']}>
            {paiements.map((paiement) => (
              <tr key={paiement.id}>
                <td className="px-3 py-2 text-slate-500">{date(paiement.createdAt)}</td>
                <td className="px-3 py-2 font-medium">
                  {formatMoney(paiement.amount, paiement.currency)}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {méthodePaiement(paiement.method)}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={libellé(STATUT_PAIEMENT, paiement.status).ton}>
                    {libellé(STATUT_PAIEMENT, paiement.status).label}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">
                  {paiement.reference}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
