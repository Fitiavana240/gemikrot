import { useQuery } from '@tanstack/react-query';
import { umTabsApi, type Consommation } from '../api/mikrotik-tabs';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from './ListeDuRouteur';
import { Section } from './Section';
import { EmptyState, TableSkeleton } from './ui';

/**
 * Ce que les clients ont consommé — jour, semaine, mois, et par compte.
 *
 * **Le découpage vient du serveur, pas d'ici.** Les sessions portent des
 * dates sans fuseau, à lire dans l'heure du routeur ; ce navigateur ne
 * connaît que celle du poste qui l'ouvre. Découper la journée ici ferait
 * tomber trois heures de sessions dans la mauvaise journée, chaque nuit — le
 * hAP de Toliara tourne en +03:00, le serveur en UTC.
 *
 * Lu seulement quand on ouvre la section : la table des sessions n'est pas
 * bornée, et un parc de plusieurs mois en porte beaucoup.
 */

/**
 * Des octets en unités lisibles, base 1000.
 *
 * C'est ce que disent les forfaits vendus à Toliara, et ce qu'un client croit
 * acheter en payant « 2 Go ». Compter en 1024 afficherait 7 % de moins que ce
 * qu'il a payé, et l'écart se voit.
 */
function octets(n: number): string {
  if (n < 1000) return `${n} o`;
  const unités = ['ko', 'Mo', 'Go', 'To'];
  let valeur = n / 1000;
  let rang = 0;
  while (valeur >= 1000 && rang < unités.length - 1) {
    valeur /= 1000;
    rang += 1;
  }
  return `${valeur.toFixed(valeur < 10 ? 1 : 0)} ${unités[rang]}`;
}

function Tranche({
  libellé,
  tranche,
}: {
  libellé: string;
  tranche: Consommation['jour'];
}) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="text-xs text-slate-500">{libellé}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">
        {octets(tranche.octets)}
      </div>
      <div className="text-xs text-slate-500">
        {tranche.sessions} session{tranche.sessions > 1 ? 's' : ''}
      </div>
    </div>
  );
}

/**
 * Une seule lecture pour les trois sections.
 *
 * React Query reconnaît la même clé : ouvrir les trois n'appelle le routeur
 * qu'une fois. C'est ce qui permet de découper l'écran en trois questions
 * sans en payer le prix trois fois.
 */
function useConsommation() {
  const { currentId } = useRouterSelection();
  return useQuery({
    queryKey: ['um-consommation', currentId],
    queryFn: () => umTabsApi.consommation(currentId),
    enabled: Boolean(currentId),
    // Cinq minutes : on regarde une consommation en travaillant, pas en
    // temps réel, et chaque lecture parcourt toute la table des sessions.
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function ConsommationDuRouteur() {
  const requête = useConsommation();
  const d = requête.data;

  return (
    <Section
      id="tdb.consommation"
      titre="Données consommées"
      compte={d ? d.parCompte.length : undefined}
      indice={d ? `heure du routeur ${d.fuseau}` : 'jour · semaine · mois'}
    >
      {requête.isPending ? (
        <TableSkeleton columns={3} rows={2} />
      ) : requête.isError ? (
        <PanneDuRouteur requête={requête} />
      ) : !d || d.sessionsDatées === 0 ? (
        <EmptyState
          title="Aucune session datée sur ce routeur."
          hint="User Manager n’a encore rien enregistré, ou le paquet n’est pas installé."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Tranche libellé="Aujourd’hui" tranche={d.jour} />
            <Tranche libellé="Cette semaine" tranche={d.semaine} />
            <Tranche libellé="Ce mois" tranche={d.mois} />
          </div>

          {/* **Le décompte des sessions illisibles est dit, jamais caché.**
              Une session sans date n'est rangée nulle part : la taire ferait
              un total qui ne correspond à rien, et personne ne saurait
              pourquoi. */}
          {d.sessionsDatées < d.sessionsLues && (
            <p className="mt-2 text-xs text-slate-500">
              {d.sessionsLues - d.sessionsDatées} session(s) sans date lisible ne sont comptées
              nulle part, sur {d.sessionsLues} lues.
            </p>
          )}

          <p className="mt-4 text-xs font-medium text-slate-500">Par compte, sur le mois</p>
          <ul className="mt-1 divide-y divide-slate-100">
            {d.parCompte.slice(0, 15).map((c) => (
              <li key={c.username} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="font-mono text-xs text-slate-900">{c.username}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">
                  {octets(c.octets)} · {c.sessions} session{c.sessions > 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
          {d.parCompte.length > 15 && (
            <p className="mt-2 text-xs text-slate-500">
              {d.parCompte.length - 15} compte(s) de plus, plus bas dans le classement.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

/**
 * Les tickets qui ont servi aujourd'hui, et d'où.
 *
 * Une ligne par compte, jamais par session : la question est « qui s'est
 * connecté aujourd'hui », pas « combien de fois ».
 */
export function TicketsDuJour() {
  const requête = useConsommation();
  const d = requête.data;

  return (
    <Section
      id="tdb.tickets-du-jour"
      titre="Tickets utilisés aujourd’hui"
      compte={d ? d.comptesDuJour.length : undefined}
      indice={d ? `heure du routeur ${d.fuseau}` : undefined}
    >
      {requête.isPending ? (
        <TableSkeleton columns={3} rows={3} />
      ) : requête.isError ? (
        <PanneDuRouteur requête={requête} />
      ) : !d || d.comptesDuJour.length === 0 ? (
        <EmptyState
          title="Aucun ticket n’a servi aujourd’hui."
          hint="La journée se compte à l’heure du routeur, pas à celle de ce poste."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {d.comptesDuJour.slice(0, 30).map((c) => (
            <li key={c.username} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="font-mono text-xs text-slate-900">{c.username}</span>
                {/* Le point d'acces a cote du nom : c'est la seule
                    << localisation >> qu'un reseau connaisse. Ni GPS, ni
                    adresse -- la borne qui a relaye la session. */}
                {c.point && <span className="ml-2 text-xs text-slate-500">{c.point}</span>}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-500">
                {octets(c.octets)} · {c.sessions} session{c.sessions > 1 ? 's' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * D'où vient la consommation — par point d'accès.
 *
 * **C'est toute la localisation qu'un réseau connaît.** Il n'y a ni position
 * géographique ni adresse là-dedans : seulement l'équipement qui a relayé la
 * session, et l'appareil que RADIUS a vu. Sur un parc à un seul routeur,
 * tout le monde partage la même ligne et elle n'apprend rien ; dès qu'il y en
 * a deux, elle dit de quel côté du quartier vient la charge.
 */
export function PointsDAcces() {
  const requête = useConsommation();
  const d = requête.data;

  return (
    <Section
      id="tdb.points-acces"
      titre="Points d’accès"
      compte={d ? d.parPointDAccès.length : undefined}
      indice="d’où vient la consommation, sur le mois"
    >
      {requête.isPending ? (
        <TableSkeleton columns={3} rows={2} />
      ) : requête.isError ? (
        <PanneDuRouteur requête={requête} />
      ) : !d || d.parPointDAccès.length === 0 ? (
        <EmptyState title="Aucune session à rattacher à un point d’accès." />
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {d.parPointDAccès.map((p) => (
              <li key={p.point} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="font-mono text-xs text-slate-900">{p.point}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">
                  {octets(p.octets)} · {p.comptes} compte{p.comptes > 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 max-w-2xl text-xs text-slate-500">
            C&apos;est la seule localisation qu&apos;un réseau connaisse : l&apos;équipement qui
            a relayé la session. Ni position géographique, ni adresse.
          </p>
        </>
      )}
    </Section>
  );
}
