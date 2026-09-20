import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { mikrotikApi } from '../api/mikrotik';
import { useRouterSelection } from '../routers/RouterContext';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  ErrorNote,
  PageHeader,
  Table,
  TableSkeleton,
} from '../components/ui';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}min`;
}

export function SessionsPage() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const { current: router } = useRouterSelection();
  const routerId = router?.id;

  const statusQuery = useQuery({
    queryKey: ['mikrotik-status', routerId],
    queryFn: () => mikrotikApi.status(routerId!),
    enabled: !!routerId,
    retry: false,
    refetchInterval: 30_000,
  });

  const sessionsQuery = useQuery({
    queryKey: ['mikrotik-active-sessions', routerId],
    queryFn: () => mikrotikApi.activeSessions(routerId!),
    enabled: !!routerId && statusQuery.isSuccess,
    refetchInterval: 10_000,
  });

  const disconnectMutation = useMutation({
    mutationFn: (sessionId: string) => mikrotikApi.disconnect(routerId!, sessionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mikrotik-active-sessions'] }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connectés"
        description="Qui est en ligne en ce moment, lu en direct sur le routeur."
      />

      {statusQuery.isLoading && <TableSkeleton columns={5} />}

      {/* L'ancien message renvoyait à MIKROTIK_BASE_URL dans un fichier .env.
          Doublement inutile : un vendeur au comptoir ne peut rien en faire, et
          ces variables ne sont plus le mécanisme depuis que les routeurs
          vivent en base avec leurs identifiants chiffrés. Ce qu'il faut dire,
          c'est ce qui continue de marcher sans la console. */}
      {statusQuery.isError && (
        <ErrorNote onRetry={() => statusQuery.refetch()}>
          Le routeur ne répond pas : impossible de savoir qui est en ligne, ni de déconnecter
          qui que ce soit.{' '}
          <strong>Les clients déjà connectés ne sont pas coupés pour autant</strong> — le
          portail et les forfaits continuent sans cette console. L'écran{' '}
          <Link to="/routers" className="font-medium underline">
            Routeurs
          </Link>{' '}
          dit depuis quand et pourquoi.
        </ErrorNote>
      )}

      {statusQuery.data && (
        <Card title={`Routeur — ${statusQuery.data.identity.name}`}>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div>
              <span className="text-slate-500">RouterOS</span>
              <p className="font-medium">{statusQuery.data.resource.version}</p>
            </div>
            <div>
              {/* « Actif depuis » sur la Vue d'ensemble, « Uptime » ici : le
                  même chiffre, deux mots, dont un en anglais. */}
              <span className="text-slate-500">Actif depuis</span>
              <p className="font-medium">{statusQuery.data.resource.uptime}</p>
            </div>
            <div>
              <span className="text-slate-500">Processeur</span>
              <p className="font-medium">{statusQuery.data.resource.cpuLoadPercent}%</p>
            </div>
            <div>
              {/* L'horloge du routeur décide des échéances : une horloge à la
                  dérive fait expirer des tickets trop tôt ou trop tard. D'où
                  sa place ici, et un mot plutôt que « NTP / synchronized ». */}
              <span className="text-slate-500">Horloge</span>
              <Badge tone={statusQuery.data.ntp.status === 'synchronized' ? 'green' : 'amber'}>
                {statusQuery.data.ntp.status === 'synchronized' ? 'à l\'heure' : 'non synchronisée'}
              </Badge>
            </div>
          </div>
        </Card>
      )}

      {sessionsQuery.data && (
        <>
          <h2 className="text-sm font-medium text-slate-500">
            Tickets actifs ({sessionsQuery.data.length})
          </h2>
          <Table head={['Code', 'IP', 'MAC', 'Connecté depuis', 'Débit reçu/envoyé', '']}>
            {sessionsQuery.data.map((session) => (
              <tr key={session.id}>
                <td className="px-3 py-2 font-mono">{session.username}</td>
                <td className="px-3 py-2">{session.address}</td>
                <td className="px-3 py-2 text-slate-500">{session.macAddress}</td>
                <td className="px-3 py-2">{formatDuration(session.uptimeSeconds)}</td>
                <td className="px-3 py-2 text-slate-500">
                  {formatBytes(session.bytesIn)} / {formatBytes(session.bytesOut)}
                </td>
                <td className="px-3 py-2 text-right">
                  {canWrite && (
                    <Button variant="danger" onClick={() => disconnectMutation.mutate(session.id)}>
                      Déconnecter
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {sessionsQuery.data.length === 0 && (
              <EmptyRow colSpan={6}>Aucun appareil connecté pour l'instant.</EmptyRow>
            )}
          </Table>
        </>
      )}

      {/* La table « tous les appareils vus » vivait ici *et* dans HotSpot ▸
          Hôtes, en moins bien : celle-là joint le nom du bail DHCP, qui est
          ce qui permet de reconnaître une télévision d'un téléphone. Cet
          écran garde ce qu'il est seul à faire — voir qui est en ligne et le
          déconnecter. */}
      <p className="text-sm text-slate-500">
        Pour la liste complète des appareils vus sur le réseau, avec leur nom :{' '}
        <Link to="/hotspot/hotes" className="font-medium text-sky-700 hover:underline">
          HotSpot ▸ Hôtes
        </Link>
        .
      </p>
    </div>
  );
}
