import { useQuery } from '@tanstack/react-query';
import { routerToolsApi } from '../api/router-tools';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, Table } from '../components/ui';

/**
 * Comment le réseau est câblé.
 *
 * Les quatre lectures sont présentées ensemble parce qu'elles ne se lisent pas
 * séparément : une adresse ne dit rien sans savoir sur quoi elle est posée, et
 * un pont ne dit rien sans ses ports. C'est cet écran qui permet de répondre à
 * « par où arrivent mes clients » sans ouvrir WinBox.
 */
export function StructureTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-structure', currentId],
    queryFn: () => routerToolsApi.structure(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 60_000,
  });

  if (requête.isError) return <PanneDuRouteur requête={requête} />;

  const adresses = requête.data?.addresses ?? [];
  const ponts = requête.data?.bridges ?? [];
  const ports = requête.data?.ports ?? [];
  const baux = requête.data?.dhcpClients ?? [];
  const dynamiques = adresses.filter((a) => a.dynamique && !a.disabled);

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Où sont posées les adresses, et quels ports travaillent ensemble. C&apos;est ici que se lit
        <strong> par où arrivent vos clients</strong> : un port actif dans le pont porte du
        trafic, un port inactif est branché sans lien — ou n&apos;est branché sur rien.
      </p>

      {/* Une adresse obtenue par DHCP peut changer du jour au lendemain. Qui la
          recopie ailleurs — dans un pair WireGuard, une règle de pare-feu —
          verra son réglage cesser de marcher sans qu'aucune erreur n'explique
          pourquoi. C'est arrivé sur ce projet, et cela a coûté une heure. */}
      {dynamiques.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>
            {dynamiques.length === 1
              ? 'Une adresse est obtenue automatiquement'
              : `${dynamiques.length} adresses sont obtenues automatiquement`}{' '}
            ({dynamiques.map((a) => a.address).join(', ')}).
          </strong>{' '}
          Elle peut changer au prochain bail. Ne la recopiez nulle part comme si elle était
          fixe — un tunnel ou une règle qui la désigne cesserait de fonctionner en silence.
        </div>
      )}

      <Card title="Adresses">
        <Table head={['Adresse', 'Réseau', 'Posée sur', 'Origine', 'État']}>
          {adresses.map((a) => (
            <tr key={a.id} className={a.disabled ? 'opacity-60' : undefined}>
              <td className="px-3 py-2 font-mono text-xs font-medium">{a.address}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-500">{a.network}</td>
              <td className="px-3 py-2">
                {a.interfaceName}
                {a.comment && <span className="ml-1.5 text-xs text-slate-400">{a.comment}</span>}
              </td>
              <td className="px-3 py-2">
                <Badge tone={a.dynamique ? 'amber' : 'slate'}>
                  {a.dynamique ? 'automatique' : 'fixée'}
                </Badge>
              </td>
              <td className="px-3 py-2">
                {a.disabled ? (
                  <Badge tone="slate">désactivée</Badge>
                ) : a.invalide ? (
                  <Badge tone="red">ne s’applique pas</Badge>
                ) : (
                  <Badge tone="green">active</Badge>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {baux.length > 0 && (
        <Card title="Accès à Internet">
          <Table head={['Interface', 'Bail', 'Adresse reçue', 'Passerelle']}>
            {baux.map((b) => (
              <tr key={b.id}>
                <td className="px-3 py-2 font-medium">{b.interfaceName}</td>
                <td className="px-3 py-2">
                  {/* `bound` est le seul état qui veut dire « ça marche » ;
                      les autres méritent d'être lus tels quels plutôt que
                      traduits en « erreur », qui perdrait le détail. */}
                  <Badge tone={b.status === 'bound' ? 'green' : 'amber'}>
                    {b.status === 'bound' ? 'obtenu' : b.status || '—'}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{b.address ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{b.gateway ?? '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {ponts.map((pont) => {
        const siens = ports.filter((p) => p.bridgeName === pont.name);
        const actifs = siens.filter((p) => !p.inactif && !p.disabled);

        return (
          <Card key={pont.id} title={`Pont ${pont.name}`}>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
              <span>
                <Badge tone={pont.disabled ? 'slate' : pont.running ? 'green' : 'red'}>
                  {pont.disabled ? 'désactivé' : pont.running ? 'actif' : 'arrêté'}
                </Badge>
              </span>
              <span className="text-slate-500">protocole {pont.protocolMode || '—'}</span>
              {pont.vlanFiltering && <span className="text-slate-500">filtrage VLAN</span>}
              <span className="text-slate-500">
                {actifs.length} port(s) qui travaillent sur {siens.length}
              </span>
            </div>

            <Table head={['Port', 'État']}>
              {siens.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium">{p.interfaceName}</td>
                  <td className="px-3 py-2">
                    {p.disabled ? (
                      <Badge tone="slate">désactivé</Badge>
                    ) : p.inactif ? (
                      // Ni panne ni normalité en soi : un port sans lien peut
                      // être une borne débranchée comme une radio qu'on n'utilise
                      // pas. Le dire, et laisser l'exploitant trancher.
                      <Badge tone="amber">sans lien</Badge>
                    ) : (
                      <Badge tone="green">porte du trafic</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        );
      })}
    </div>
  );
}
