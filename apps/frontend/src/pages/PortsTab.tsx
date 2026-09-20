import { useQuery } from '@tanstack/react-query';
import { routerToolsApi, type PortEthernet } from '../api/router-tools';
import { formatOctets } from '../api/mikrotik-tabs';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, Table, TableSkeleton } from '../components/ui';

/**
 * « 100Mbps » → « 100M », le préfixe des modes de négociation.
 *
 * RouterOS écrit le débit négocié et les modes annoncés dans deux vocabulaires
 * différents. Les rapprocher est la seule façon de dire **pourquoi** une
 * négociation a mal tourné, et pas seulement qu'elle a mal tourné.
 */
function préfixeDébit(rate: string | null): string | null {
  if (!rate) return null;
  const m = /^(\d+)([MG])/.exec(rate);
  return m ? `${m[1]}${m[2]}` : null;
}

type Diagnostic = {
  ton: 'green' | 'amber' | 'red' | 'slate';
  titre: string;
  détail?: string;
  /** La commande exacte, quand il y en a une qui règle le problème. */
  remède?: string;
};

/**
 * Ce que l'état d'un port dit, et ce qu'il faut en faire.
 *
 * Le cas qui justifie cet écran : un port négocié en **demi-duplex**. Le
 * protocole y rend les collisions normales, donc le lien fonctionne — mal,
 * par à-coups, sans jamais rien signaler. Aucun écran de la console ne le
 * montrait, et l'onglet Interfaces n'affiche que des erreurs agrégées où
 * cette cause-là disparaît.
 */
export function diagnostic(p: PortEthernet): Diagnostic {
  if (p.disabled) return { ton: 'slate', titre: 'Port désactivé' };
  if (!p.running) {
    return {
      ton: 'slate',
      titre: 'Aucun lien',
      détail: 'Rien de branché, ou l’appareil d’en face est éteint.',
    };
  }

  if (p.fullDuplex === false) {
    const préfixe = préfixeDébit(p.rate);
    const modeAttendu = préfixe ? `${préfixe}-baseT-full` : null;
    // La cause se lit en comparant les deux listes annoncées : si l'appareil
    // d'en face propose le duplex intégral à ce débit et que ce port ne le
    // propose pas, la négociation n'avait pas d'autre choix que la moitié.
    const partenairePeut = modeAttendu != null && p.partnerAdvertise.includes(modeAttendu);
    const nousPouvons = modeAttendu != null && p.advertise.includes(modeAttendu);

    if (partenairePeut && !nousPouvons) {
      return {
        ton: 'red',
        titre: `Demi-duplex à ${p.rate} — et c’est ce routeur qui l’impose`,
        détail:
          `L’appareil branché ici accepte ${p.rate} en duplex intégral, mais ce port ne le ` +
          `propose pas : la liste des modes annoncés a été modifiée et ${modeAttendu} en a ` +
          `été retiré. La négociation n’avait donc que le demi-duplex comme terrain d’entente.`,
        remède: `/interface ethernet set ${p.name} advertise=${[...p.advertise, modeAttendu].join(',')}`,
      };
    }
    return {
      ton: 'red',
      titre: `Demi-duplex à ${p.rate}`,
      détail:
        'Sur une liaison commutée, le duplex intégral est la normale. En demi-duplex les ' +
        'collisions font partie du protocole : le lien marche, mais par à-coups, et rien ne ' +
        'le signale. Vérifiez le câble et l’appareil d’en face.',
    };
  }

  if (p.fcsErrors > 0) {
    return {
      ton: 'amber',
      titre: `${p.fcsErrors.toLocaleString('fr-FR')} trames abîmées`,
      détail:
        'Des séquences de contrôle fausses désignent presque toujours le câble ou la prise. ' +
        'Le remplacer est la première chose à essayer.',
    };
  }

  if (p.collisions > 0) {
    return {
      ton: 'amber',
      titre: `${p.collisions.toLocaleString('fr-FR')} collisions comptées`,
      détail:
        'Le port est en duplex intégral aujourd’hui : ces collisions sont donc anciennes. ' +
        'Les compteurs ne se remettent pas à zéro tout seuls — un redémarrage dira si le ' +
        'problème persiste.',
    };
  }

  return { ton: 'green', titre: `${p.rate} en duplex intégral` };
}

export function PortsTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-ethernet', currentId],
    queryFn: () => routerToolsApi.ethernet(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 60_000,
  });

  if (requête.isError) return <PanneDuRouteur requête={requête} />;

  const ports = requête.data ?? [];
  const fautifs = ports.filter((p) => diagnostic(p).ton === 'red');

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Les ports cuivre, et surtout <strong>ce qu&apos;ils ont négocié</strong> avec
        l&apos;appareil d&apos;en face. Un port peut marcher et mal marcher en même temps :
        c&apos;est le cas le plus difficile à trouver quand un client se plaint de lenteur.
      </p>

      {fautifs.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>
            {fautifs.length === 1
              ? `Le port ${fautifs[0].name} ne travaille pas dans de bonnes conditions.`
              : `${fautifs.length} ports ne travaillent pas dans de bonnes conditions.`}
          </strong>{' '}
          Le détail est plus bas. Rien n&apos;est coupé — c&apos;est justement pourquoi
          personne ne le remarque.
        </div>
      )}

      {requête.isPending ? (
        <Card>
          <TableSkeleton columns={6} />
        </Card>
      ) : (
        <Card title={`${ports.length} port(s) cuivre`}>
          <Table head={['Port', 'Lien', 'Reçu', 'Envoyé', 'Collisions', 'Trames abîmées']}>
            {ports.map((p) => {
              const d = diagnostic(p);
              return (
                <tr key={p.id} className={p.disabled ? 'opacity-60' : undefined}>
                  <td className="px-3 py-2 font-medium">
                    {p.name}
                    {p.comment && (
                      <span className="ml-1.5 text-xs text-slate-400">{p.comment}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={d.ton}>
                      {p.running ? `${p.rate ?? '—'} ${p.fullDuplex ? 'intégral' : 'moitié'}` : 'sans lien'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">
                    {formatOctets(p.rxBytes)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">
                    {formatOctets(p.txBytes)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    <span className={p.collisions > 0 ? 'font-medium text-red-700' : 'text-slate-400'}>
                      {p.collisions.toLocaleString('fr-FR')}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    <span
                      className={
                        p.fcsErrors + p.fragments > 0
                          ? 'font-medium text-amber-700'
                          : 'text-slate-400'
                      }
                    >
                      {(p.fcsErrors + p.fragments).toLocaleString('fr-FR')}
                    </span>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {/* Le détail n'est montré que pour les ports qui ont quelque chose à
          dire : aligner cinq encarts « tout va bien » noierait le seul qui
          compte, ce qui est exactement le défaut qu'on vient de corriger
          ailleurs. */}
      {ports
        .map((p) => ({ port: p, d: diagnostic(p) }))
        .filter(({ d }) => d.détail && d.ton !== 'slate')
        .map(({ port, d }) => (
          <Card key={port.id} title={`${port.name} — ${d.titre}`}>
            <p
              className={`max-w-3xl text-sm ${
                d.ton === 'red' ? 'text-red-800' : 'text-amber-800'
              }`}
            >
              {d.détail}
            </p>

            {d.remède && (
              <div className="mt-3">
                <p className="text-sm text-slate-600">
                  La commande qui corrige, à coller dans le terminal du routeur. Le lien
                  renégocie : <strong>ce port se coupe une seconde ou deux</strong>, le temps
                  que l&apos;appareil d&apos;en face refasse sa poignée de main.
                </p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2.5 font-mono text-xs text-slate-100">
                  {d.remède}
                </pre>
              </div>
            )}

            {port.partnerAdvertise.length > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
                <div>
                  <p className="mb-1 font-medium text-slate-600">Ce port propose</p>
                  <ul className="space-y-0.5 text-slate-500">
                    {port.advertise.map((m) => (
                      <li key={m} className="font-mono">
                        {m}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-medium text-slate-600">L&apos;appareil d&apos;en face propose</p>
                  <ul className="space-y-0.5 text-slate-500">
                    {port.partnerAdvertise.map((m) => (
                      <li
                        key={m}
                        className={
                          port.advertise.includes(m) ? 'font-mono' : 'font-mono text-red-700'
                        }
                      >
                        {m}
                        {!port.advertise.includes(m) && (
                          <span className="ml-1.5 font-sans">— pas proposé par ce port</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Card>
        ))}
    </div>
  );
}
