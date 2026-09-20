import { useQuery } from '@tanstack/react-query';
import { routerToolsApi } from '../api/router-tools';
import { formatDuree } from '../api/mikrotik-tabs';
import { useRouterSelection } from '../routers/RouterContext';
import { ListeDuRouteur, PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, Table } from '../components/ui';

/**
 * Ce que dit un signal, en dBm.
 *
 * Les seuils ne sont pas décoratifs : au-delà de −70 la liaison se dégrade
 * visiblement, au-delà de −80 elle ne tient plus. Un client qui se plaint de
 * lenteur alors que son forfait est valide se lit ici avant de se chercher
 * ailleurs.
 */
function tonSignal(dbm: number | null): 'green' | 'amber' | 'red' | 'slate' {
  if (dbm == null) return 'slate';
  if (dbm >= -70) return 'green';
  if (dbm >= -80) return 'amber';
  return 'red';
}

/** « 2ghz-b/g/n » → « 2,4 GHz ». Le détail des normes n'aide personne ici. */
function bandeLisible(band: string): string {
  if (band.startsWith('2ghz')) return '2,4 GHz';
  if (band.startsWith('5ghz')) return '5 GHz';
  return band || '—';
}

export function WifiTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-wireless', currentId],
    queryFn: () => routerToolsApi.wireless(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 30_000,
  });
  const radius = useQuery({
    queryKey: ['tools-radius', currentId],
    queryFn: () => routerToolsApi.radius(currentId!),
    enabled: Boolean(currentId),
  });

  const radios = requête.data?.radios ?? [];
  const clients = requête.data?.clients ?? [];
  // Une radio activée qui n'émet pas : ni panne ni normalité en soi, cela
  // dépend de l'installation. Le dire plutôt que de le peindre en rouge.
  const dormantes = radios.filter((r) => !r.disabled && !r.running);

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Les radios du routeur lui-même. <strong>Ce ne sont pas forcément celles qui diffusent</strong> :
        beaucoup d&apos;installations laissent le routeur router et confient le Wi-Fi à des bornes
        branchées sur ses ports Ethernet. L&apos;écran <em>Interfaces</em> dit par où passe le
        trafic.
      </p>

      {requête.isError ? (
        <PanneDuRouteur requête={requête} />
      ) : (
        <>
          {dormantes.length > 0 && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              {dormantes.length === radios.length ? (
                <>
                  <strong>Aucune radio de ce routeur n&apos;émet.</strong> Elles sont activées mais à
                  l&apos;arrêt : le Wi-Fi de vos clients vient donc d&apos;ailleurs — des bornes
                  branchées sur les ports Ethernet. Ce n&apos;est pas une panne si c&apos;est voulu.
                </>
              ) : (
                <>
                  <strong>
                    {dormantes.length} radio(s) activée(s) mais à l&apos;arrêt :{' '}
                    {dormantes.map((r) => r.name).join(', ')}.
                  </strong>{' '}
                  Elles ne diffusent rien en l&apos;état.
                </>
              )}
            </div>
          )}

          <Card title={`${radios.length} radio(s)`}>
            <Table
              head={['Radio', 'Réseau (SSID)', 'Bande', 'Canal', 'Largeur', 'Sécurité', 'Puissance', 'État']}
            >
              {radios.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2">
                    {r.ssid || '—'}
                    {r.hideSsid && (
                      <span className="ml-1.5 text-xs text-slate-500">(masqué)</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{bandeLisible(r.band)}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {r.frequency === 'auto' ? 'automatique' : r.frequency}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{r.channelWidth || '—'}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {/* Un profil « default » en mode ouvert veut dire que le
                        réseau n'est pas chiffré — ce qui est le cas normal
                        d'un portail captif, où c'est le portail qui filtre. */}
                    {r.securityProfile || '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">
                    {r.txPowerDbm != null ? `${r.txPowerDbm} dBm` : 'automatique'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={r.disabled ? 'slate' : r.running ? 'green' : 'amber'}>
                      {r.disabled ? 'désactivée' : r.running ? 'émet' : 'à l’arrêt'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title={`${clients.length} client(s) sur ces radios`}>
            <ListeDuRouteur
              requête={{ ...requête, data: clients }}
              colonnes={['Radio', 'Appareil', 'Signal', 'Débit reçu', 'Débit envoyé', 'Connecté depuis']}
              vide={{
                titre: 'Aucun client sur ces radios',
                aide: 'Normal si le Wi-Fi vient de bornes externes : leurs clients ne passent pas par les radios du routeur.',
              }}
              ligne={(c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">{c.interfaceName}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{c.macAddress}</td>
                  <td className="px-3 py-2">
                    <Badge tone={tonSignal(c.signalStrengthDbm)}>
                      {c.signalStrengthDbm != null ? `${c.signalStrengthDbm} dBm` : '—'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{c.rxRate ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{c.txRate ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDuree(c.uptimeSeconds)}</td>
                </tr>
              )}
            />
          </Card>
        </>
      )}

      {/* RADIUS est la pièce qui relie le HotSpot à User Manager. Sans elle,
          aucun ticket n'est vérifié — et rien ailleurs ne le dirait. */}
      <Card title="RADIUS — le lien entre le portail et les comptes">
        {radius.isError ? (
          <PanneDuRouteur requête={radius} />
        ) : (radius.data ?? []).length === 0 ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <strong>Aucun client RADIUS déclaré.</strong> Le portail ne peut donc vérifier aucun
            ticket auprès de User Manager, quels que soient les comptes enregistrés.
          </p>
        ) : (
          <Table head={['Sert', 'Adresse', 'Port authentification', 'Port comptabilité', 'Délai', 'État']}>
            {(radius.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{r.services.join(', ') || '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.address}
                  {r.address === '127.0.0.1' && (
                    <span className="ml-1.5 font-sans text-xs text-slate-500">
                      (User Manager sur ce routeur)
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-500">{r.authenticationPort ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums text-slate-500">{r.accountingPort ?? '—'}</td>
                <td className="px-3 py-2 text-slate-500">{r.timeout ?? '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={r.disabled ? 'red' : 'green'}>
                    {r.disabled ? 'désactivé' : 'actif'}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
