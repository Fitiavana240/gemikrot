import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { tenantsApi, type OffrePlateforme } from '../api/tenants';
import { formatMoney } from '../api/money';
import { Badge, Card, PageHeader } from '../components/ui';

/**
 * L'abonnement de l'exploitant à la plateforme — et, quand il a expiré, le
 * mur qui le lui apprend.
 *
 * Il n'y avait qu'un bandeau. Un bandeau se lit une fois puis devient du
 * décor : l'exploitant découvrait la vente fermée en cliquant sur
 * « Générer », au comptoir, devant un client qui attend. C'est le pire
 * moment et le pire endroit pour l'apprendre.
 *
 * **Ce que la page dit d'abord, c'est ce qui n'arrive pas.** Les clients
 * finaux gardent leur accès : le routeur applique seul les validités et
 * continue de les servir. Sans cette phrase en tête, un exploitant en retard
 * croit son réseau coupé et appelle ses clients un par un pour s'excuser de
 * rien.
 *
 * **Et la consultation reste ouverte.** Fermer aussi la lecture reviendrait à
 * prendre ses données en otage pour une facture. Le lien « Consulter mes
 * données » est donc offert sur le mur lui-même, pas caché.
 */

/** En deçà, l'échéance mérite d'être annoncée. Au-delà, c'est du bruit. */
const PREVENIR_JOURS = 10;

function Compte({ jours }: { jours: number | null }) {
  if (jours == null) return null;
  const n = Math.abs(jours);
  return <>{n} jour{n > 1 ? 's' : ''}</>;
}

function CarteOffre({
  offre,
  routeurs,
  devise,
  encours,
}: {
  offre: OffrePlateforme;
  routeurs: number;
  devise: string;
  encours: boolean;
}) {
  // Au moins un routeur : afficher « 0 Ar » à qui n'en a pas encore raccordé
  // lui ferait croire la plateforme gratuite.
  const total = offre.prixParRouteur * Math.max(routeurs, 1);

  return (
    <div
      className={`rounded-lg border p-4 ${
        encours ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{offre.nom}</h3>
        {encours && <Badge tone="green">Votre offre</Badge>}
      </div>

      <p className="mt-2 text-2xl font-semibold text-slate-900">
        {offre.prixParRouteur === 0 ? 'Gratuit' : formatMoney(offre.prixParRouteur, devise)}
        {offre.prixParRouteur > 0 && (
          <span className="text-sm font-normal text-slate-500">
            {' '}
            par routeur et par {offre.periode}
          </span>
        )}
      </p>

      {offre.prixParRouteur > 0 && (
        <p className="mt-1 text-sm text-slate-600">
          Votre parc : <strong>{Math.max(routeurs, 1)} routeur(s)</strong> —{' '}
          <strong>{formatMoney(total, devise)}</strong> par {offre.periode}.
        </p>
      )}

      <p className="mt-3 text-sm text-slate-600">{offre.argument}</p>

      <p className="mt-3 text-xs text-slate-500">
        {offre.maxRouteurs == null
          ? 'Routeurs illimités.'
          : `${offre.maxRouteurs} routeur(s) au maximum.`}{' '}
        {offre.toleranceJours > 0
          ? `${offre.toleranceJours} jours de tolérance après l'échéance.`
          : 'Aucune tolérance après échéance.'}
      </p>
    </div>
  );
}

function Contact({
  contact,
}: {
  contact: { telephone: string | null; whatsapp: string | null; courriel: string | null };
}) {
  const rien = !contact.telephone && !contact.whatsapp && !contact.courriel;

  // Dire qu'on ne sait pas vaut mieux qu'afficher un numéro mort à quelqu'un
  // qui cherche justement à payer.
  if (rien) {
    return (
      <p className="text-sm text-slate-600">
        Aucun moyen de contact n&apos;est configuré sur cette installation. Adressez-vous à la
        personne qui vous a ouvert ce compte.
      </p>
    );
  }

  return (
    <ul className="space-y-1 text-sm text-slate-700">
      {contact.telephone && (
        <li>
          Téléphone :{' '}
          <a className="font-medium text-sky-700 hover:underline" href={`tel:${contact.telephone}`}>
            {contact.telephone}
          </a>
        </li>
      )}
      {contact.whatsapp && (
        <li>
          WhatsApp :{' '}
          <a
            className="font-medium text-sky-700 hover:underline"
            href={`https://wa.me/${contact.whatsapp}`}
            target="_blank"
            rel="noreferrer"
          >
            +{contact.whatsapp}
          </a>
        </li>
      )}
      {contact.courriel && (
        <li>
          Courriel :{' '}
          <a
            className="font-medium text-sky-700 hover:underline"
            href={`mailto:${contact.courriel}`}
          >
            {contact.courriel}
          </a>
        </li>
      )}
    </ul>
  );
}

/**
 * Le corps de la page, partagé entre l'écran ordinaire et le mur de blocage.
 *
 * Les deux disent exactement la même chose : ce qu'on paie, à qui, et ce qui
 * se ferme. Les séparer ferait deux textes qui divergeraient au premier
 * changement de tarif.
 */
export function AbonnementCorps({ mur = false }: { mur?: boolean }) {
  const abonnement = useQuery({
    queryKey: ['abonnement-plateforme'],
    queryFn: tenantsApi.monAbonnement,
    retry: false,
  });
  const catalogue = useQuery({
    queryKey: ['offres-plateforme'],
    queryFn: tenantsApi.offres,
    // Un catalogue ne change pas pendant qu'on le lit.
    staleTime: 5 * 60_000,
    retry: false,
  });

  const a = abonnement.data;
  const devise = a?.devise ?? 'MGA';

  const ton =
    a?.etat === 'expire'
      ? 'border-red-300 bg-red-50 text-red-900'
      : a?.etat === 'en-tolerance'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-slate-200 bg-white text-slate-800';

  return (
    <div className="space-y-4">
      {/* L'état, en premier et en toutes lettres. */}
      <div className={`rounded-lg border px-4 py-3 ${ton}`}>
        {!a ? (
          <p className="text-sm">Lecture de votre abonnement…</p>
        ) : (
          <>
            <p className="font-semibold">
              {a.etat === 'expire' &&
                'Votre abonnement à la plateforme a expiré : la vente est suspendue.'}
              {a.etat === 'en-tolerance' && (
                <>
                  Votre abonnement est échu. Il vous reste <Compte jours={a.joursRestants} /> avant
                  que la vente ne se ferme.
                </>
              )}
              {a.etat === 'a-jour' &&
                ((a.joursRestants ?? 99) <= PREVENIR_JOURS ? (
                  <>
                    Votre abonnement arrive à échéance dans <Compte jours={a.joursRestants} />.
                  </>
                ) : (
                  <>
                    Votre abonnement est à jour
                    {a.joursRestants != null && (
                      <>
                        {' '}
                        pour encore <Compte jours={a.joursRestants} />
                      </>
                    )}
                    .
                  </>
                ))}
              {a.etat === 'sans-abonnement' &&
                "Aucun abonnement n'est enregistré sur votre compte : rien ne se ferme."}
            </p>

            {/* Ce qui n'arrive pas compte autant que ce qui arrive. */}
            <p className="mt-2 text-sm">
              Vos clients, eux, <strong>gardent leur accès</strong> : le routeur applique seul les
              validités et continue de les servir. La consultation de vos données reste ouverte —
              seules les ventes nouvelles s&apos;arrêtent.
            </p>

            <p className="mt-2 text-xs">
              {a.offre ? `Offre ${a.offre}` : 'Aucune offre'}
              {a.maxRouteurs != null
                ? ` · ${a.routeursUtilises}/${a.maxRouteurs} routeur(s)`
                : ` · ${a.routeursUtilises} routeur(s)`}
              {a.echeance && ` · échéance ${new Date(a.echeance).toLocaleDateString('fr-FR')}`}
              {a.finDeTolerance &&
                a.finDeTolerance !== a.echeance &&
                ` · tolérance jusqu'au ${new Date(a.finDeTolerance).toLocaleDateString('fr-FR')}`}
            </p>
          </>
        )}
      </div>

      {mur && (
        <p className="text-sm text-slate-600">
          <Link to="/?lecture=1" className="font-medium text-sky-700 hover:underline">
            Consulter mes données en lecture seule
          </Link>{' '}
          — vos clients, vos recettes et votre journal restent accessibles.
        </p>
      )}

      <Card title="Les offres">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(catalogue.data?.offres ?? []).map((offre) => (
            <CarteOffre
              key={offre.code}
              offre={offre}
              routeurs={a?.routeursUtilises ?? 0}
              devise={devise}
              encours={a?.offreCode === offre.code}
            />
          ))}
        </div>
      </Card>

      <Card title="Régler votre abonnement">
        <p className="mb-3 text-sm text-slate-600">
          Le renouvellement se pose à la main : contactez la plateforme, réglez, et votre échéance
          est repoussée dans la minute. Une période encore en cours n&apos;est jamais perdue — la
          nouvelle repart de sa fin, pas d&apos;aujourd&apos;hui.
        </p>
        {catalogue.data && <Contact contact={catalogue.data.contact} />}
      </Card>
    </div>
  );
}

export function AbonnementPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Mon abonnement"
        description="Ce que vous devez à la plateforme, jusqu'à quand, et ce qui se ferme si rien n'est réglé."
      />
      <AbonnementCorps />
    </div>
  );
}
