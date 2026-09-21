import { useQuery } from '@tanstack/react-query';
import { routerToolsApi, type ClientConnexions } from '../api/router-tools';
import { formatOctets } from '../api/mikrotik-tabs';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, Table, TableSkeleton } from '../components/ui';

/**
 * Au-delà de cette part du total, un seul appareil pèse sur tous les autres.
 *
 * Un cinquième est déjà beaucoup quand quarante clients se partagent le
 * réseau : la part attendue serait de 2 ou 3 %.
 */
const PART_DOMINANTE = 0.2;

/** Combien de clients on affiche : au-delà, la queue de liste n'apprend rien. */
const CLIENTS_AFFICHES = 25;

/**
 * Qui tient le plus de connexions ouvertes.
 *
 * Répond à « pourquoi c'est lent » avec un nom. Le débit par client dit
 * « beaucoup de trafic » ; le nombre de connexions dit autre chose, et les
 * deux ne se recoupent pas — un appareil peut consommer peu et tenir des
 * centaines de connexions, signature d'un gestionnaire de téléchargement,
 * d'un partage pair à pair, ou d'un appareil qui réessaie en boucle.
 */
export function ConnexionsTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-connexions', currentId],
    queryFn: () => routerToolsApi.connexions(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 60_000,
  });

  if (requête.isError) return <PanneDuRouteur requête={requête} />;

  const data = requête.data;
  const clients = data?.clients ?? [];
  const total = data?.total ?? 0;
  const dominant = clients.find((c) => total > 0 && c.connexions / total >= PART_DOMINANTE);
  const occupation = data && data.maxEntries > 0 ? data.total / data.maxEntries : 0;

  const nom = (c: ClientConnexions) => c.username || c.hostname || c.address;

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Le nombre de connexions qu&apos;un appareil tient ouvertes en même temps.{' '}
        <strong>Ce n&apos;est pas le débit</strong> : un appareil peut consommer peu et tenir
        des centaines de connexions. C&apos;est souvent cette liste, et non celle des débits,
        qui désigne le responsable d&apos;une lenteur générale.
      </p>

      {requête.isPending ? (
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      ) : (
        <>
          {dominant && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>
                {nom(dominant)} tient {dominant.connexions} connexions sur {total}, soit{' '}
                {Math.round((dominant.connexions / total) * 100)} % à lui seul.
              </strong>{' '}
              Avec {clients.length} appareils sur le réseau, la part attendue serait de{' '}
              {Math.max(1, Math.round(100 / clients.length))} %. Ce n&apos;est pas une panne —
              un téléchargement ou une vidéo en ouvrent beaucoup — mais c&apos;est le premier
              endroit où regarder si tout le monde trouve le réseau lent.
            </div>
          )}

          <Card title="Table de suivi du routeur">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">Connexions suivies</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums">{total}</div>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">Plafond du routeur</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums">
                  {data?.maxEntries.toLocaleString('fr-FR')}
                </div>
                {/* Le plafond n'est pas décoratif : atteint, plus AUCUNE
                    connexion ne passe, pour personne. */}
                <div className="mt-0.5 text-xs text-slate-500">
                  {Math.round(occupation * 1000) / 10} % occupé
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">Une connexion inactive reste</div>
                <div className="mt-0.5 text-lg font-semibold">
                  {data?.tcpEstablishedTimeout || '—'}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">comptée pendant ce temps</div>
              </div>
            </div>
            {occupation >= 0.8 && (
              <p className="mt-3 max-w-3xl text-sm text-red-800">
                <strong>La table est presque pleine.</strong> Quand elle l&apos;est, plus
                aucune connexion nouvelle ne passe — pour personne, pas seulement pour celui
                qui l&apos;a remplie.
              </p>
            )}
          </Card>

          <Card title={`${clients.length} appareil(s) avec des connexions ouvertes`}>
            <Table head={['Appareil', 'Compte', 'Connexions', 'Part', 'Descendu']}>
              {clients.slice(0, CLIENTS_AFFICHES).map((c) => {
                const part = total > 0 ? c.connexions / total : 0;
                return (
                  <tr key={c.address} className={part >= PART_DOMINANTE ? 'bg-amber-50/60' : undefined}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{c.hostname || c.address}</span>
                      {c.hostname && (
                        <div className="font-mono text-xs text-slate-400">{c.address}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {/* Trois états, et non deux. Un appareil peut être
                          autorisé sans qu'une session porte son nom — par
                          cookie, typiquement. Écrire « non connecté » dans ce
                          cas serait faux, et c'était le défaut du premier
                          essai, qui cherchait le nom dans le mauvais menu. */}
                      {c.username ? (
                        c.username
                      ) : c.autorise ? (
                        <Badge tone="green">autorisé</Badge>
                      ) : c.autorise === false ? (
                        <span className="text-xs text-slate-400">pas authentifié</span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums font-medium">{c.connexions}</td>
                    <td className="px-3 py-2">
                      <Badge tone={part >= PART_DOMINANTE ? 'amber' : 'slate'}>
                        {Math.round(part * 100)} %
                      </Badge>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">
                      {c.bytesOut != null ? formatOctets(c.bytesOut) : '—'}
                    </td>
                  </tr>
                );
              })}
            </Table>
            {clients.length > CLIENTS_AFFICHES && (
              <p className="mt-3 text-xs text-slate-500">
                {CLIENTS_AFFICHES} appareils affichés sur {clients.length}, du plus gros au
                plus petit.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
