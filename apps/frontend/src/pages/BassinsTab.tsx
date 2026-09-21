import { useQuery } from '@tanstack/react-query';
import { routerToolsApi, type BassinAdresses } from '../api/router-tools';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, Table, TableSkeleton } from '../components/ui';

/** Au-delà, il reste assez peu d'adresses pour qu'une affluence les prenne. */
const SERRE = 0.8;

/** Au-delà, la prochaine vague de clients se heurte au mur. */
const CRITIQUE = 0.95;

/**
 * Le nom du propriétaire, dit en français.
 *
 * `DHCP` est l'adresse donnée à l'appareil ; `hotspot` est celle que le
 * portail prend **en plus** pour le même client, en NAT un-pour-un. Les
 * laisser tels quels ferait lire deux services distincts là où il n'y a
 * qu'un seul client.
 */
const PROPRIÉTAIRE: Record<string, string> = {
  DHCP: 'baux DHCP (un par appareil)',
  hotspot: 'portail, en plus du bail',
  ppp: 'liaisons PPPoE',
};

function occupation(b: BassinAdresses): number | null {
  if (b.total == null || b.total === 0 || b.used == null) return null;
  return b.used / b.total;
}

/**
 * Combien d'adresses part un seul client, portail compris.
 *
 * C'est la seule forme utilisable au comptoir. Quand le portail prend une
 * adresse de plus par client, dire « 216 adresses libres » laisse croire à
 * 216 clients possibles, alors qu'il y en a la moitié.
 */
function adressesParClient(b: BassinAdresses): number {
  const baux = b.byOwner.find((o) => o.owner === 'DHCP')?.count ?? 0;
  const portail = b.byOwner.find((o) => o.owner === 'hotspot')?.count ?? 0;
  if (baux === 0) return 1;
  // Arrondi au dixième : « 1,5 adresse par client » se lit, 1,4499 non.
  return Math.round(((baux + portail) / baux) * 10) / 10;
}

/**
 * Les bassins d'adresses, et ce qu'il reste de place.
 *
 * L'écran qui manquait pour une panne qu'aucun autre ne montre. Un bassin
 * épuisé ne se voit ni dans les comptes, ni dans les sessions, ni dans le
 * journal : le client reste simplement sans adresse, donc sans portail, et
 * tout le reste paraît normal. WinBox le range sous IP ▸ Pool, loin de
 * l'endroit où on va chercher quand « le wifi ne marche pas ».
 */
export function BassinsTab() {
  const { currentId } = useRouterSelection();
  const bassins = useQuery({
    queryKey: ['tools-bassins', currentId],
    queryFn: () => routerToolsApi.pools(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 60_000,
  });
  const serveurs = useQuery({
    queryKey: ['tools-dhcp-servers', currentId],
    queryFn: () => routerToolsApi.dhcpServers(currentId!),
    enabled: Boolean(currentId),
  });

  if (bassins.isError) return <PanneDuRouteur requête={bassins} />;

  const liste = bassins.data ?? [];
  const tendus = liste.filter((b) => (occupation(b) ?? 0) >= SERRE);

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        D&apos;où viennent les adresses que reçoivent vos clients. C&apos;est le{' '}
        <strong>plafond réel du nombre de connectés en même temps</strong>, et il n&apos;a
        aucun rapport avec le nombre de tickets vendus : épuisé, le routeur ne distribue plus
        d&apos;adresse, le portail ne s&apos;affiche même pas, et rien ailleurs ne le signale.
      </p>

      {bassins.isPending ? (
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      ) : (
        <>
          {tendus.map((b) => {
            const part = occupation(b) ?? 0;
            const parClient = adressesParClient(b);
            const clientsRestants = Math.floor((b.available ?? 0) / parClient);
            return (
              <div
                key={b.id}
                className={`rounded-lg border px-4 py-3 text-sm ${
                  part >= CRITIQUE
                    ? 'border-red-200 bg-red-50 text-red-800'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <strong>
                  Le bassin « {b.name} » est occupé à {Math.round(part * 100)} %.
                </strong>{' '}
                Il reste de quoi servir environ{' '}
                <strong>{clientsRestants} client(s) de plus</strong>
                {parClient > 1 && (
                  <>
                    {' '}
                    — et non {b.available}, parce que le portail prend {parClient} adresses par
                    client
                  </>
                )}
                . Au bout, les suivants n&apos;auront pas d&apos;adresse du tout : ils verront
                « connecté, sans Internet » sans jamais voir le portail. Agrandir la plage, ou
                raccourcir la durée des baux, règle les deux cas.
              </div>
            );
          })}

          <Card title={`${liste.length} bassin(s) d’adresses`}>
            <Table head={['Bassin', 'Plage', 'Capacité', 'Occupé', 'Libre', 'Qui les tient']}>
              {liste.map((b) => {
                const part = occupation(b);
                return (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-medium">{b.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{b.ranges}</td>
                    <td className="px-3 py-2 tabular-nums">{b.total ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className="tabular-nums font-medium">{b.used ?? '—'}</span>{' '}
                      {part != null && (
                        <Badge
                          tone={part >= CRITIQUE ? 'red' : part >= SERRE ? 'amber' : 'green'}
                        >
                          {Math.round(part * 100)} %
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">
                      {b.available ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {b.byOwner.length === 0 ? (
                        <span className="text-slate-400">personne</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {b.byOwner.map((o) => (
                            <li key={o.owner}>
                              <span className="tabular-nums font-medium">{o.count}</span>{' '}
                              <span className="text-slate-500">
                                {PROPRIÉTAIRE[o.owner] ?? o.owner}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
            {/* Le fait qui trompe même ceux qui ont pensé à regarder le
                bassin : le total des adresses prises dépasse le nombre
                d'appareils. Mesuré ici : 20 baux pour 29 adresses. */}
            <p className="mt-3 max-w-3xl text-xs text-slate-500">
              Le portail prend une <strong>seconde adresse</strong> du même bassin pour chaque
              client, en plus de son bail. Compter les appareils connectés pour estimer la
              place restante donne donc un chiffre trop optimiste — c&apos;est la colonne
              « Libre » qui fait foi, divisée par le nombre d&apos;adresses par client.
            </p>
          </Card>

          <Card title="Serveurs DHCP qui puisent dans ces bassins">
            <Table head={['Serveur', 'Interface', 'Bassin', 'Durée du bail', 'État']}>
              {(serveurs.data ?? []).map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{s.interfaceName}</td>
                  <td className="px-3 py-2">{s.addressPool ?? '—'}</td>
                  <td className="px-3 py-2">{s.leaseTime ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge tone={s.disabled ? 'slate' : s.invalid ? 'red' : 'green'}>
                      {s.disabled ? 'désactivé' : s.invalid ? 'invalide' : 'actif'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 max-w-3xl text-xs text-slate-500">
              La <strong>durée du bail</strong> décide du temps qu&apos;une adresse reste
              réservée après le départ du client. Sur un réseau de passage, un bail long garde
              des adresses au nom d&apos;appareils déjà partis.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
