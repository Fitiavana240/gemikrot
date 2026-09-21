import { useState } from 'react';
import { Confirmation } from '../components/Edition';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { mikrotikApi } from '../api/mikrotik';
import { hotspotApi } from '../api/hotspot';
import { phraseCoupure } from '../api/coupure';
import { ENTREE_SESSION, libellé, revientSeul } from '../api/libelles';
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

  const [compteRendu, setCompteRendu] = useState<string | null>(null);
  /** Le geste demandé sur une ligne, tant qu'il n'est pas confirmé. */
  const [àConfirmer, setÀConfirmer] = useState<{
    geste: 'deconnecter' | 'couper';
    id: string;
    username: string;
  } | null>(null);

  const disconnectMutation = useMutation({
    mutationFn: (sessionId: string) => mikrotikApi.disconnect(routerId!, sessionId),
    onSuccess: () => {
      setCompteRendu(null);
      setÀConfirmer(null);
      queryClient.invalidateQueries({ queryKey: ['mikrotik-active-sessions'] });
    },
  });

  /**
   * La coupure qui tient, par opposition à la simple déconnexion.
   *
   * Fermer la session ne suffit pas pour qui est entré par cookie : le client
   * se reconnecte seul en quelques secondes, et l'écran — qui se rafraîchit
   * toutes les dix secondes — le montre revenir. Effacer ses cookies est ce
   * qui le tient dehors.
   */
  const couperMutation = useMutation({
    mutationFn: (username: string) => hotspotApi.cutAccess(username, routerId),
    onSuccess: (coupure) => {
      setCompteRendu(phraseCoupure(coupure));
      setÀConfirmer(null);
      queryClient.invalidateQueries({ queryKey: ['mikrotik-active-sessions'] });
    },
  });

  return (
    <div className="space-y-6">
      {àConfirmer && (
        <Confirmation
          titre={
            àConfirmer.geste === 'couper'
              ? `Voulez-vous vraiment couper l’accès de « ${àConfirmer.username} » ?`
              : `Voulez-vous vraiment déconnecter « ${àConfirmer.username} » ?`
          }
          enCours={disconnectMutation.isPending || couperMutation.isPending}
          onAnnuler={() => setÀConfirmer(null)}
          onConfirmer={() => {
            if (àConfirmer.geste === 'couper') couperMutation.mutate(àConfirmer.username);
            else disconnectMutation.mutate(àConfirmer.id);
          }}
        >
          {àConfirmer.geste === 'couper' ? (
            <>
              La session se ferme <strong>et</strong> les cookies du compte sont effacés — ce
              sont eux qui le ramèneraient tout seul. C&apos;est la coupure qui tient : un
              client en règle devra retaper son code.
            </>
          ) : (
            <>
              La session se ferme et la place est libérée, mais le client garde son accès :
              s&apos;il est entré par cookie, il revient seul en quelques secondes.
            </>
          )}
        </Confirmation>
      )}

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

          {compteRendu && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {compteRendu}
            </p>
          )}

          {sessionsQuery.data.some((s) => revientSeul(s.loginBy)) && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Les sessions marquées <strong>cookie</strong> se refont toutes seules : le client n'a
              rien à retaper, et le routeur ne consulte même pas User Manager. Les déconnecter les
              montre revenir au rafraîchissement suivant. <strong>Couper l'accès</strong> efface
              leurs cookies : c'est ce qui les tient dehors.
            </p>
          )}
          <Table head={['Code', 'IP', 'Entré par', 'Connecté depuis', 'Reçu / envoyé', '']}>
            {sessionsQuery.data.map((session) => (
              <tr key={session.id}>
                <td className="px-3 py-2 font-mono">{session.username}</td>
                <td className="px-3 py-2">{session.address}</td>
                {/* La MAC ne disait rien à personne à cet endroit ; la façon dont
                    la session est entrée décide, elle, du geste à faire. */}
                <td className="px-3 py-2">
                  <Badge tone={libellé(ENTREE_SESSION, session.loginBy).ton}>
                    {libellé(ENTREE_SESSION, session.loginBy).label}
                  </Badge>
                </td>
                <td className="px-3 py-2">{formatDuration(session.uptimeSeconds)}</td>
                <td className="px-3 py-2 text-slate-500">
                  {formatBytes(session.bytesIn)} / {formatBytes(session.bytesOut)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {/* Deux gestes qui ne veulent pas dire la même chose —
                      déconnecter libère la place, couper empêche de revenir —
                      et que deux boutons voisins ne distinguaient pas. La
                      fenêtre dit lequel fait quoi avant qu'on choisisse. */}
                  {canWrite && (
                    <span className="space-x-2">
                      <Button
                        variant="secondary"
                        disabled={disconnectMutation.isPending}
                        onClick={() =>
                          setÀConfirmer({
                            geste: 'deconnecter',
                            id: session.id,
                            username: session.username,
                          })
                        }
                      >
                        Déconnecter
                      </Button>
                      <Button
                        variant="danger"
                        disabled={couperMutation.isPending}
                        onClick={() =>
                          setÀConfirmer({
                            geste: 'couper',
                            id: session.id,
                            username: session.username,
                          })
                        }
                      >
                        Couper l&apos;accès
                      </Button>
                    </span>
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
