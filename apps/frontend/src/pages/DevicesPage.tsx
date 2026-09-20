import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { devicesApi, type Device, type DeviceType, type DiscoveredDevice } from '../api/devices';
import { useRouterSelection } from '../routers/RouterContext';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { libellé, TYPE_APPAREIL, type Libellé } from '../api/libelles';
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  ErrorNote,
  PageHeader,
  Select,
  Table,
} from '../components/ui';

const DEVICE_TYPES: DeviceType[] = ['PHONE', 'COMPUTER', 'TV', 'CAMERA', 'ROUTER', 'OTHER'];

/**
 * Ce que vaut la proposition de type.
 *
 * Elle était calculée par le serveur et jetée par l'écran. C'est pourtant le
 * seul renseignement qui compte au moment de confirmer : un nom DHCP reconnu
 * (« SmartTV-Salon ») et un préfixe de fabricant qui ne dit rien du type
 * arrivaient tous deux sans nuance, et le second propose toujours
 * « indéterminé ». Sans ce repère, confirmer devient un réflexe.
 */
const FIABILITÉ: Record<DiscoveredDevice['confidence'], Libellé> = {
  high: { label: 'nom reconnu', ton: 'green' },
  medium: { label: 'à vérifier', ton: 'amber' },
  low: { label: 'simple supposition', ton: 'amber' },
};

/**
 * Trois états, là où l'écran n'en montrait que deux.
 *
 * `bypassEnabled` à faux recouvrait deux situations opposées, et la console
 * les peignait toutes les deux en rouge, « Bloqué » :
 *
 * - **jamais contourné** — l'immense majorité. Le téléphone passe par le
 *   portail comme tout le monde, il marche parfaitement. Le dire bloqué est
 *   simplement faux, et envoie chercher une panne qui n'existe pas.
 * - **contournement coupé** — un `ip-binding` de type `blocked` subsiste sur
 *   le routeur : là, le trafic de l'appareil est jeté, il n'atteint même pas
 *   la page de connexion.
 *
 * `mikrotikBindingId` les sépare exactement : il n'existe que si un
 * contournement a été créé un jour.
 */
type ÉtatPortail = 'contourné' | 'bloqué' | 'normal';

function étatPortail(device: Device): ÉtatPortail {
  if (device.bypassEnabled) return 'contourné';
  return device.mikrotikBindingId ? 'bloqué' : 'normal';
}

const ÉTAT_PORTAIL: Record<ÉtatPortail, Libellé> = {
  contourné: { label: 'passe sans portail', ton: 'green' },
  normal: { label: 'passe par le portail', ton: 'slate' },
  bloqué: { label: 'bloqué au routeur', ton: 'red' },
};

export function DevicesPage() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const { current: router } = useRouterSelection();
  const [error, setError] = useState<string | null>(null);
  const [typeChoice, setTypeChoice] = useState<Record<string, DeviceType>>({});

  const devices = useQuery({ queryKey: ['devices'], queryFn: devicesApi.list });
  const discovered = useQuery({
    queryKey: ['devices-discover', router?.id],
    queryFn: () => devicesApi.discover(router?.id),
    enabled: !!router,
    retry: false,
    refetchInterval: 30_000,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['devices'] });
    queryClient.invalidateQueries({ queryKey: ['devices-discover'] });
  }
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Erreur inconnue');

  const register = useMutation({
    mutationFn: devicesApi.register,
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });
  const enableBypass = useMutation({
    mutationFn: devicesApi.enableBypass,
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });
  const block = useMutation({
    mutationFn: devicesApi.block,
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });

  function confirmType(device: DiscoveredDevice) {
    register.mutate({
      macAddress: device.macAddress,
      type: typeChoice[device.macAddress] ?? device.suggestedType,
      ipAddress: device.ipAddress ?? undefined,
      hostname: device.hostname ?? undefined,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appareils"
        description="Ce qui se connecte au réseau. Le contournement du portail sert aux appareils incapables d'afficher une page de connexion — télévision, caméra, imprimante."
      />

      {error && (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      )}

      <Card title="Détectés sur le réseau — le type proposé doit être confirmé">
        {/* Sans routeur choisi, la détection ne part pas : la requête reste
            désactivée, `data` reste vide, et la table s'affichait nue — ni
            ligne, ni message, ni erreur. Le dire vaut mieux que ce silence. */}
        {!router ? (
          <p className="text-sm text-slate-500">
            Choisissez un routeur dans la barre du haut : les appareils sont lus sur ses baux
            DHCP.
          </p>
        ) : discovered.isLoading ? (
          <p className="text-slate-500">Analyse des baux DHCP…</p>
        ) : discovered.isError ? (
          /* Même silence quand le routeur ne répond pas : `data` restait vide
             et la ligne « aucun bail » ne s'affichait pas davantage, sa garde
             comparant `undefined` à zéro. On lisait donc une table vide, ce
             qui se confond avec « aucun appareil sur le réseau » — la
             conclusion inverse de la vraie. */
          <ErrorNote onRetry={() => discovered.refetch()}>
            Le routeur ne répond pas : impossible de lire les appareils présents sur le réseau.{' '}
            <strong>Les contournements déjà en place continuent de fonctionner</strong> — c'est le
            routeur qui les applique, pas cette console. L'écran{' '}
            <Link to="/routers" className="font-medium underline">
              Routeurs
            </Link>{' '}
            dit depuis quand et pourquoi.
          </ErrorNote>
        ) : (
          <Table head={['MAC', 'Nom DHCP', 'IP', 'Type proposé', 'Sur quel indice', '']}>
            {discovered.data?.map((device) => (
              <tr key={device.macAddress}>
                <td className="px-3 py-2 font-mono text-xs">{device.macAddress}</td>
                <td className="px-3 py-2">{device.hostname ?? '—'}</td>
                <td className="px-3 py-2 text-slate-500">{device.ipAddress ?? '—'}</td>
                <td className="px-3 py-2">
                  {device.known ? (
                    <Badge tone={libellé(TYPE_APPAREIL, device.suggestedType).ton}>
                      {libellé(TYPE_APPAREIL, device.suggestedType).label} (enregistré)
                    </Badge>
                  ) : (
                    <Select
                      className="w-auto"
                      value={typeChoice[device.macAddress] ?? device.suggestedType}
                      onChange={(e) =>
                        setTypeChoice({
                          ...typeChoice,
                          [device.macAddress]: e.target.value as DeviceType,
                        })
                      }
                    >
                      {DEVICE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {libellé(TYPE_APPAREIL, type).label}
                        </option>
                      ))}
                    </Select>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {!device.known && (
                    <Badge tone={FIABILITÉ[device.confidence].ton}>
                      {FIABILITÉ[device.confidence].label}
                    </Badge>
                  )}{' '}
                  {device.detectionSource}
                </td>
                <td className="px-3 py-2 text-right">
                  {canWrite && !device.known && (
                    <Button variant="secondary" onClick={() => confirmType(device)}>
                      Confirmer
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {discovered.data?.length === 0 && (
              <EmptyRow colSpan={6}>Aucun bail DHCP visible sur le routeur.</EmptyRow>
            )}
          </Table>
        )}
      </Card>

      <h2 className="text-sm font-medium text-slate-500">Appareils enregistrés</h2>
      {/* Une adresse MAC ne dit rien à personne. Le nom DHCP est ce qui
          permet de reconnaître la télévision du salon ; il était enregistré
          en base et n'apparaissait que dans la table du dessus. */}
      <Table head={['Nom', 'MAC', 'Type', 'Portail captif', 'Détecté comme', '']}>
        {devices.data?.map((device) => {
          const état = étatPortail(device);
          return (
            <tr key={device.id}>
              <td className="px-3 py-2">{device.hostname ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-xs">{device.macAddress}</td>
              <td className="px-3 py-2">
                <Badge tone={libellé(TYPE_APPAREIL, device.type).ton}>
                  {libellé(TYPE_APPAREIL, device.type).label}
                </Badge>
              </td>
              <td className="px-3 py-2">
                <Badge tone={ÉTAT_PORTAIL[état].ton}>{ÉTAT_PORTAIL[état].label}</Badge>
              </td>
              <td className="px-3 py-2 text-xs text-slate-500">{device.detectionSource ?? '—'}</td>
              {/* Sans cela, « Activer le contournement » se casse en deux
                  lignes et déforme la rangée : la colonne est la dernière,
                  elle peut prendre la largeur dont elle a besoin. */}
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {canWrite &&
                  (état === 'contourné' ? (
                    <Button variant="danger" onClick={() => block.mutate(device.id)}>
                      Bloquer
                    </Button>
                  ) : (
                    /* Le même appel dans les deux cas, mais pas le même acte :
                       sur un appareil bloqué il remet le binding existant en
                       `bypassed`, il ne crée rien. Promettre « activer » là où
                       l'on rétablit ferait douter d'avoir cliqué juste. */
                    <Button onClick={() => enableBypass.mutate(device.id)}>
                      {état === 'bloqué' ? 'Rétablir' : 'Activer le contournement'}
                    </Button>
                  ))}
              </td>
            </tr>
          );
        })}
        {devices.data?.length === 0 && (
          <EmptyRow colSpan={6}>Aucun appareil enregistré.</EmptyRow>
        )}
      </Table>
    </div>
  );
}
