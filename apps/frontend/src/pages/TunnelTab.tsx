import { useQuery } from '@tanstack/react-query';
import { routerToolsApi, type PairTunnel } from '../api/router-tools';
import { formatDuree, formatOctets } from '../api/mikrotik-tabs';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, Table } from '../components/ui';
import { AideRouteur, AIDE_TUNNEL } from '../components/AideRouteur';

/**
 * Au-delà de trois minutes, le pair ne répond plus.
 *
 * WireGuard n'a pas d'état « connecté » : une interface qui tourne ne dit rien
 * du lien. La dernière poignée de main est le seul indicateur, et le
 * `persistent-keepalive` étant à 25 secondes, trois minutes de silence sont
 * déjà six occasions manquées.
 */
const SILENCE_INQUIETANT = 180;

/**
 * Ce que les compteurs disent de la panne.
 *
 * Du trafic émis sans rien reçu est la signature exacte d'un pair qui parle
 * dans le vide : adresse d'extrémité injoignable, port fermé, serveur éteint.
 * C'est le diagnostic le plus utile du menu, et il ne se lit qu'en comparant
 * deux colonnes — autant le faire à la place de l'exploitant.
 */
function diagnostic(pair: PairTunnel): { ton: 'green' | 'amber' | 'red'; texte: string } {
  if (pair.disabled) return { ton: 'red', texte: 'Pair désactivé : le tunnel ne peut pas monter.' };

  const jamais = pair.lastHandshakeSeconds == null;
  const vieux = !jamais && pair.lastHandshakeSeconds! > SILENCE_INQUIETANT;

  if (pair.txBytes > 0 && pair.rxBytes === 0) {
    return {
      ton: 'red',
      texte:
        'Le routeur émet et ne reçoit rien : personne ne répond à l’adresse configurée. Vérifiez qu’elle est joignable depuis l’extérieur et que le port est ouvert.',
    };
  }
  if (jamais) {
    return { ton: 'red', texte: 'Aucune poignée de main : le tunnel n’a jamais été établi.' };
  }
  if (vieux) {
    return {
      ton: 'amber',
      texte: `Dernière poignée de main il y a ${formatDuree(pair.lastHandshakeSeconds)} — le pair ne répond plus.`,
    };
  }
  return { ton: 'green', texte: 'Le tunnel est vivant.' };
}

export function TunnelTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-wireguard', currentId],
    queryFn: () => routerToolsApi.wireguard(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 30_000,
  });

  if (requête.isError) return <PanneDuRouteur requête={requête} />;

  const chemin = requête.data?.chemin;
  const interfaces = requête.data?.interfaces ?? [];
  const pairs = requête.data?.peers ?? [];

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Le tunnel permet à cette console d&apos;atteindre le routeur sans qu&apos;il ait
        d&apos;adresse publique : <strong>c&apos;est le routeur qui appelle</strong>, jamais
        l&apos;inverse. Tant que le tunnel tient, la console pilote un routeur situé n&apos;importe
        où ; quand il tombe, <strong>les clients ne sont pas coupés pour autant</strong> — le
        portail et les forfaits continuent sans elle.
      </p>

      {/* La seule question que l'exploitant se pose vraiment. */}
      {chemin && (
        <div
          className={
            chemin.parLeTunnel
              ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900'
              : 'rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700'
          }
        >
          {chemin.parLeTunnel ? (
            <>
              <strong>Cette console passe par le tunnel</strong> pour joindre ce routeur, à
              l&apos;adresse <span className="font-mono">{chemin.adresse}</span>.
            </>
          ) : (
            <>
              <strong>Cette console joint le routeur directement</strong>, à l&apos;adresse{' '}
              <span className="font-mono">{chemin.adresse}</span> — pas par le tunnel. C&apos;est ce
              qu&apos;il faut sur un routeur du même réseau ; pour un routeur distant, il faut
              l&apos;enrôler depuis l&apos;écran Routeurs.
            </>
          )}
        </div>
      )}

      {interfaces.length === 0 ? (
        <Card title="Aucun tunnel sur ce routeur">
          <p className="text-sm text-slate-600">
            Ce routeur ne porte pas d&apos;interface WireGuard. La console ne peut donc l&apos;
            atteindre que depuis son réseau local.
          </p>
        </Card>
      ) : (
        <Card title="Interface">
          <Table head={['Nom', 'Port d’écoute', 'Clé publique', 'État']}>
            {interfaces.map((i) => (
              <tr key={i.id}>
                <td className="px-3 py-2 font-medium">{i.name}</td>
                <td className="px-3 py-2 tabular-nums text-slate-500">{i.listenPort ?? '—'}</td>
                <td className="max-w-[18rem] truncate px-3 py-2 font-mono text-xs text-slate-500">
                  {i.publicKey}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={i.disabled ? 'slate' : i.running ? 'green' : 'red'}>
                    {i.disabled ? 'désactivée' : i.running ? 'active' : 'arrêtée'}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {pairs.length > 0 && (
        <Card title={`${pairs.length} pair(s)`}>
          <div className="space-y-3">
            {pairs.map((p) => {
              const d = diagnostic(p);
              return (
                <div key={p.id} className="rounded-lg border border-slate-200 px-3 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-medium">{p.name ?? p.publicKey.slice(0, 12)}</span>
                    <span className="text-slate-500">
                      appelle{' '}
                      <span className="font-mono text-xs">
                        {p.endpointAddress ?? '—'}
                        {p.endpointPort ? `:${p.endpointPort}` : ''}
                      </span>
                    </span>
                    <span className="text-slate-500">
                      route <span className="font-mono text-xs">{p.allowedAddress}</span>
                    </span>
                    <Badge tone={d.ton}>
                      {p.lastHandshakeSeconds != null
                        ? `poignée de main il y a ${formatDuree(p.lastHandshakeSeconds)}`
                        : 'jamais établie'}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-6 text-xs text-slate-500">
                    <span>émis : {formatOctets(p.txBytes)}</span>
                    <span>reçu : {formatOctets(p.rxBytes)}</span>
                  </div>
                  <p
                    className={`mt-2 text-sm ${
                      d.ton === 'red'
                        ? 'text-red-700'
                        : d.ton === 'amber'
                          ? 'text-amber-800'
                          : 'text-emerald-700'
                    }`}
                  >
                    {d.texte}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Les lectures qui repondent a la seule question qu'on se pose ici :
          << est-ce que le tunnel marche ? >>. WireGuard n'a pas d'etat
          << connecte >>, et la poignee de main est ce qu'on ne pense jamais a
          regarder. */}
      <AideRouteur
        titre="Vérifier le tunnel depuis le routeur"
        lignes={AIDE_TUNNEL}
        note={
          <>
            <strong>Si le tunnel ne monte pas, vos clients ne sont pas coupés.</strong> Le HotSpot
            et User Manager continuent de tourner seuls sur le routeur : c&apos;est la console qui
            perd la main, pas le Wi-Fi.
          </>
        }
      />
    </div>
  );
}
