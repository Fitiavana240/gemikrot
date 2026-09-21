import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Badge, Card, PageHeader, PanneDeLecture, Table, TableSkeleton } from '../components/ui';
import { Stat } from '../components/Stat';

/**
 * SAS-4 : la plateforme vue d'en haut.
 *
 * Le SUPER_ADMIN avait la liste de ses exploitants, et rien d'autre. Pour
 * savoir si l'un d'eux était en panne, il fallait se mettre à sa place, un
 * par un — donc savoir d'avance lequel regarder, ce qui est justement
 * l'information qui manquait.
 *
 * **Rien n'est demandé aux routeurs.** Leur état vient de ce que la base a
 * retenu du dernier contact : interroger vingt routeurs pour dessiner un
 * tableau les ferait tous attendre, et un seul lien lent rendrait la page
 * inutilisable. Ce qui s'affiche est « aux dernières nouvelles », et la page
 * le dit plutôt que de laisser croire à du direct.
 */

interface Ligne {
  id: string;
  nom: string;
  reseau: string;
  statut: string;
  abonnement: string;
  joursRestants: number | null;
  routeurs: number;
  routeursJoignables: number;
  clients: number;
  recette30j: string;
  devise: string;
  paiementsEnAttente: number;
  dernierContact: string | null;
}

interface Supervision {
  exploitants: Ligne[];
  totaux: {
    exploitants: number;
    actifs: number;
    routeurs: number;
    routeursJoignables: number;
    clients: number;
    paiementsEnAttente: number;
  };
  alertes: string[];
}

const ABONNEMENT: Record<string, { label: string; ton: 'green' | 'amber' | 'red' | 'slate' }> = {
  'a-jour': { label: 'à jour', ton: 'green' },
  'en-tolerance': { label: 'échu, en tolérance', ton: 'amber' },
  expire: { label: 'expiré', ton: 'red' },
  'sans-abonnement': { label: 'aucun', ton: 'slate' },
};

const STATUT: Record<string, { label: string; ton: 'green' | 'amber' | 'red' | 'slate' }> = {
  ACTIVE: { label: 'actif', ton: 'green' },
  PENDING: { label: 'en attente', ton: 'amber' },
  SUSPENDED: { label: 'suspendu', ton: 'red' },
};

function quand(iso: string | null): string {
  if (!iso) return 'jamais';
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  return `il y a ${Math.floor(heures / 24)} j`;
}

export function SupervisionPage() {
  const requête = useQuery({
    queryKey: ['supervision'],
    queryFn: () => api.get<Supervision>('/tenants/supervision'),
    // Une minute : ces chiffres bougent quand un routeur se tait ou qu'un
    // client paie, pas à la seconde.
    refetchInterval: 60_000,
    retry: false,
  });

  const d = requête.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supervision"
        description="La plateforme vue d'en haut : qui vend, qui est en panne, qui doit de l'argent."
      />

      {requête.isPending ? (
        <TableSkeleton columns={5} rows={3} />
      ) : requête.isError ? (
        <PanneDeLecture requête={requête} quoi="la supervision" />
      ) : (
        <>
          {/* Les alertes avant les chiffres : un exploitant muet ne se lit pas
              dans une colonne, il se lit en une phrase. */}
          {d?.alertes.map((a) => (
            <div
              key={a}
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {a}
            </div>
          ))}

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Exploitants"
              value={d!.totaux.exploitants}
              hint={`${d!.totaux.actifs} actif(s)`}
              to="/tenants"
            />
            <Stat
              label="Routeurs joignables"
              value={`${d!.totaux.routeursJoignables} / ${d!.totaux.routeurs}`}
              tone={
                d!.totaux.routeurs > 0 && d!.totaux.routeursJoignables < d!.totaux.routeurs
                  ? 'alerte'
                  : 'bien'
              }
              hint="aux dernières nouvelles"
            />
            <Stat label="Clients" value={d!.totaux.clients} hint="tous exploitants" />
            <Stat
              label="Paiements en attente"
              value={d!.totaux.paiementsEnAttente}
              tone={d!.totaux.paiementsEnAttente > 0 ? 'alerte' : 'neutre'}
              hint={d!.totaux.paiementsEnAttente > 0 ? 'des clients attendent' : 'rien en file'}
            />
          </section>

          <Card title="Par exploitant">
            <Table
              head={[
                'Exploitant',
                'Statut',
                'Abonnement',
                'Routeurs',
                'Clients',
                'Recette 30 j',
                'En attente',
                'Dernier contact',
              ]}
            >
              {d!.exploitants.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2">
                    <Link to="/tenants" className="font-medium text-sky-700 hover:underline">
                      {e.nom}
                    </Link>
                    <div className="text-xs text-slate-500">{e.reseau}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUT[e.statut]?.ton ?? 'slate'}>
                      {STATUT[e.statut]?.label ?? e.statut}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={ABONNEMENT[e.abonnement]?.ton ?? 'slate'}>
                      {ABONNEMENT[e.abonnement]?.label ?? e.abonnement}
                    </Badge>
                    {e.joursRestants !== null && e.abonnement !== 'sans-abonnement' && (
                      <span className="ml-1.5 text-xs text-slate-500">
                        {e.joursRestants} j
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {/* Le rapport, pas le total : « 1 » ne dit pas s'il
                        répond. */}
                    <span
                      className={
                        e.routeurs > 0 && e.routeursJoignables === 0
                          ? 'font-medium text-red-700'
                          : ''
                      }
                    >
                      {e.routeursJoignables} / {e.routeurs}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{e.clients}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {Number(e.recette30j).toLocaleString('fr-FR')} {e.devise}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {e.paiementsEnAttente > 0 ? (
                      <span className="font-medium text-amber-800">{e.paiementsEnAttente}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{quand(e.dernierContact)}</td>
                </tr>
              ))}
            </Table>
          </Card>

          <p className="max-w-3xl text-xs text-slate-500">
            <strong>Rien n&apos;est demandé aux routeurs pour dessiner ce tableau.</strong> Leur
            état vient de ce que la base a retenu du dernier contact : les interroger tous
            ferait attendre la page sur le plus lent d&apos;entre eux. Un routeur est compté
            joignable s&apos;il a donné signe de vie dans la dernière demi-heure — la colonne
            « dernier contact » dit quand.
          </p>
        </>
      )}
    </div>
  );
}
