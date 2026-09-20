import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { devicesApi, type DeviceType, type DiscoveredDevice } from '../api/devices';
import { useRouterSelection } from '../routers/RouterContext';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Badge, Button, Card, PageHeader, Select, Table } from '../components/ui';

const DEVICE_TYPES: DeviceType[] = ['PHONE', 'COMPUTER', 'TV', 'CAMERA', 'ROUTER', 'OTHER'];

/** Un appareil sans navigateur ne peut pas afficher la page captive. */
const NEEDS_BYPASS: DeviceType[] = ['TV', 'CAMERA'];

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
        {discovered.isLoading ? (
          <p className="text-slate-500">Analyse des baux DHCP…</p>
        ) : (
          <Table head={['MAC', 'Nom DHCP', 'IP', 'Type proposé', 'Indice', '']}>
            {discovered.data?.map((device) => (
              <tr key={device.macAddress}>
                <td className="px-3 py-2 font-mono text-xs">{device.macAddress}</td>
                <td className="px-3 py-2">{device.hostname ?? '—'}</td>
                <td className="px-3 py-2 text-slate-500">{device.ipAddress ?? '—'}</td>
                <td className="px-3 py-2">
                  {device.known ? (
                    <Badge tone="green">{device.suggestedType} (enregistré)</Badge>
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
                          {type}
                        </option>
                      ))}
                    </Select>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{device.detectionSource}</td>
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
              <tr>
                <td className="px-3 py-4 text-slate-400" colSpan={6}>
                  Aucun bail DHCP visible sur le routeur.
                </td>
              </tr>
            )}
          </Table>
        )}
      </Card>

      <h2 className="text-sm font-medium text-slate-500">Appareils enregistrés</h2>
      <Table head={['MAC', 'Type', 'Contournement', 'Détecté comme', '']}>
        {devices.data?.map((device) => (
          <tr key={device.id}>
            <td className="px-3 py-2 font-mono text-xs">{device.macAddress}</td>
            <td className="px-3 py-2">
              <Badge tone={NEEDS_BYPASS.includes(device.type) ? 'amber' : 'slate'}>
                {device.type}
              </Badge>
            </td>
            <td className="px-3 py-2">
              <Badge tone={device.bypassEnabled ? 'green' : 'red'}>
                {device.bypassEnabled ? 'Actif' : 'Bloqué'}
              </Badge>
            </td>
            <td className="px-3 py-2 text-xs text-slate-500">{device.detectionSource ?? '—'}</td>
            <td className="px-3 py-2 text-right">
              {canWrite &&
                (device.bypassEnabled ? (
                  <Button variant="danger" onClick={() => block.mutate(device.id)}>
                    Bloquer
                  </Button>
                ) : (
                  <Button onClick={() => enableBypass.mutate(device.id)}>
                    Activer le contournement
                  </Button>
                ))}
            </td>
          </tr>
        ))}
        {devices.data?.length === 0 && (
          <tr>
            <td className="px-3 py-4 text-slate-400" colSpan={5}>
              Aucun appareil enregistré.
            </td>
          </tr>
        )}
      </Table>
    </div>
  );
}
