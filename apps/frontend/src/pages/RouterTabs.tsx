import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatDebit,
  formatDuree,
  formatOctets,
  hotspotTabsApi,
  umTabsApi,
} from '../api/mikrotik-tabs';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { useRouterSelection } from '../routers/RouterContext';
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Input,
  Table,
  TableSkeleton,
} from '../components/ui';

/**
 * Les onglets qui manquaient face à WinBox.
 *
 * Chacun lit le routeur en direct — ce sont des tables du matériel, pas des
 * copies en base. C'est pour cela qu'ils affichent une erreur plutôt qu'un
 * tableau vide quand le routeur ne répond pas : un vide serait un mensonge.
 */

/** Affichage commun : attente, erreur, vide, puis le contenu. */
function Liste<T>({
  requête,
  colonnes,
  vide,
  ligne,
}: {
  requête: { isPending: boolean; isError: boolean; data?: T[]; refetch: () => unknown };
  colonnes: string[];
  vide: { titre: string; aide?: string };
  ligne: (item: T, index: number) => React.ReactNode;
}) {
  if (requête.isPending) return <TableSkeleton columns={colonnes.length} />;
  if (requête.isError) {
    return (
      <ErrorNote onRetry={() => requête.refetch()}>
        Le routeur n'a pas répondu — cette table est lue en direct, elle n'a pas de copie en base.
      </ErrorNote>
    );
  }
  const lignes = requête.data ?? [];
  if (lignes.length === 0) return <EmptyState title={vide.titre} hint={vide.aide} />;
  return <Table head={colonnes}>{lignes.map(ligne)}</Table>;
}

/** Filtre en mémoire : ces tables tiennent en quelques centaines de lignes. */
function useFiltre<T>(items: T[] | undefined, champs: (item: T) => (string | null | undefined)[]) {
  const [terme, setTerme] = useState('');
  const bas = terme.trim().toLowerCase();
  const filtrés = !bas
    ? (items ?? [])
    : (items ?? []).filter((item) =>
        champs(item).some((v) => (v ?? '').toLowerCase().includes(bas)),
      );
  return { terme, setTerme, filtrés };
}

export function HotspotUsersTab() {
  const { currentId } = useRouterSelection();
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const [àSupprimer, setÀSupprimer] = useState<string | null>(null);

  const requête = useQuery({
    queryKey: ['hotspot-users', currentId],
    queryFn: () => hotspotTabsApi.users(currentId),
  });
  const { terme, setTerme, filtrés } = useFiltre(requête.data, (u) => [
    u.username,
    u.profile,
    u.comment,
  ]);

  const onError = (e: unknown) =>
    setErreur(e instanceof ApiError ? e.message : 'Le routeur a refusé cette action.');
  const rafraîchir = () => {
    setErreur(null);
    void queryClient.invalidateQueries({ queryKey: ['hotspot-users', currentId] });
  };

  const bloquer = useMutation({
    mutationFn: ({ username, disabled }: { username: string; disabled: boolean }) =>
      hotspotTabsApi.setUserDisabled(username, disabled, currentId),
    onSuccess: rafraîchir,
    onError,
  });
  const supprimer = useMutation({
    mutationFn: (username: string) => hotspotTabsApi.deleteUser(username, currentId),
    onSuccess: () => {
      setÀSupprimer(null);
      rafraîchir();
    },
    onError,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-600">
          La table du HotSpot lui-même. Un compte d'ici n'expire pas à une date : seul le profil
          borne sa session, et la borne repart à chaque reconnexion. Le trafic affiché est cumulé
          depuis la création du compte.
        </p>
        <span className="shrink-0 text-sm text-slate-500">{filtrés.length} compte(s)</span>
      </div>

      <Input
        value={terme}
        onChange={(e) => setTerme(e.target.value)}
        placeholder="Filtrer par nom, profil ou commentaire"
        className="max-w-sm"
      />

      {erreur && <ErrorNote>{erreur}</ErrorNote>}

      {/* Une suppression perd le trafic consommé et le nom porté par le
          commentaire : la confirmer nomme ce qu'on perd, plutôt que de
          demander « êtes-vous sûr ». */}
      {àSupprimer && (
        <ErrorNote>
          Supprimer « {àSupprimer} » efface son trafic consommé et son commentaire, sans retour
          possible. Le bloquer suffit le plus souvent.
          <span className="ml-3 inline-flex gap-2">
            <Button variant="danger" onClick={() => supprimer.mutate(àSupprimer)}>
              Supprimer quand même
            </Button>
            <Button variant="secondary" onClick={() => setÀSupprimer(null)}>
              Annuler
            </Button>
          </span>
        </ErrorNote>
      )}

      <Liste
        requête={{ ...requête, data: filtrés }}
        colonnes={['Compte', 'Client', 'Profil', 'Durée', 'Reçu', 'Envoyé', 'État', '']}
        vide={{ titre: 'Aucun compte HotSpot', aide: 'Cette table est vide sur le routeur.' }}
        ligne={(u) => (
          <tr key={u.id} className={u.disabled ? 'opacity-60' : undefined}>
            <td className="px-3 py-2 font-mono text-xs">{u.username}</td>
            {/* Sur ce parc, le commentaire porte le nom de la personne :
                c'est le seul lien entre un compte et quelqu'un. */}
            <td className="max-w-[12rem] truncate px-3 py-2">{u.comment ?? '—'}</td>
            <td className="px-3 py-2 text-slate-600">{u.profile || '—'}</td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {formatDuree(u.uptimeSeconds)}
              {u.limitUptimeSeconds != null && (
                <span className="text-slate-400"> / {formatDuree(u.limitUptimeSeconds)}</span>
              )}
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">{formatOctets(u.bytesIn)}</td>
            <td className="px-3 py-2 tabular-nums text-slate-500">{formatOctets(u.bytesOut)}</td>
            <td className="px-3 py-2">
              <Badge tone={u.disabled ? 'red' : 'green'}>
                {u.disabled ? 'bloqué' : 'actif'}
              </Badge>
            </td>
            <td className="space-x-2 whitespace-nowrap px-3 py-2 text-right">
              {canWrite && (
                <>
                  <Button
                    variant="secondary"
                    disabled={bloquer.isPending}
                    onClick={() =>
                      bloquer.mutate({ username: u.username, disabled: !u.disabled })
                    }
                  >
                    {u.disabled ? 'Débloquer' : 'Bloquer'}
                  </Button>
                  <Button variant="danger" onClick={() => setÀSupprimer(u.username)}>
                    Supprimer
                  </Button>
                </>
              )}
            </td>
          </tr>
        )}
      />
    </div>
  );
}

export function HotspotProfilesTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['hotspot-profiles', currentId],
    queryFn: () => hotspotTabsApi.profiles(currentId),
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Le profil borne le débit et la durée d'<em>une</em> session. Il ne fait pas expirer un
        ticket : la durée repart à zéro à chaque reconnexion. C'est pourquoi les ventes passent
        par User Manager.
      </p>
      <Liste
        requête={requête}
        colonnes={['Profil', 'Descendant', 'Montant', 'Durée de session', 'Appareils']}
        vide={{ titre: 'Aucun profil HotSpot' }}
        ligne={(p) => (
          <tr key={p.id}>
            <td className="px-3 py-2 font-medium">{p.name}</td>
            <td className="px-3 py-2 tabular-nums">{formatDebit(p.rateLimitRxBitsPerSecond)}</td>
            <td className="px-3 py-2 tabular-nums">{formatDebit(p.rateLimitTxBitsPerSecond)}</td>
            <td className="px-3 py-2 tabular-nums">{formatDuree(p.sessionTimeoutSeconds)}</td>
            <td className="px-3 py-2 tabular-nums">{p.sharedUsers}</td>
          </tr>
        )}
      />
    </div>
  );
}

export function HotspotHostsTab() {
  const { currentId } = useRouterSelection();
  const hôtes = useQuery({
    queryKey: ['hotspot-hosts', currentId],
    queryFn: () => hotspotTabsApi.hosts(currentId),
    refetchInterval: 30_000,
  });
  const baux = useQuery({
    queryKey: ['dhcp-leases', currentId],
    queryFn: () => hotspotTabsApi.dhcpLeases(currentId),
  });

  // Le nom de l'appareil vient du bail DHCP, pas de la table des hôtes :
  // c'est lui qui permet de reconnaître une TV d'un téléphone.
  const nomParMac = new Map(
    (baux.data ?? []).map((b) => [b.macAddress.toUpperCase(), b.hostName ?? b.comment]),
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Tout ce que le routeur voit sur le réseau, authentifié ou non. Un hôte sans session est
        souvent un appareil incapable d'afficher un portail captif — télévision, caméra,
        imprimante.
      </p>
      <Liste
        requête={hôtes}
        colonnes={['Adresse MAC', 'Nom', 'Adresse IP', 'Serveur', 'Inactif depuis']}
        vide={{ titre: 'Aucun hôte', aide: 'Personne n\'est connecté au réseau en ce moment.' }}
        ligne={(h) => (
          <tr key={h.id}>
            <td className="px-3 py-2 font-mono text-xs">{h.macAddress}</td>
            <td className="px-3 py-2">
              {nomParMac.get(h.macAddress.toUpperCase()) ?? (
                <span className="text-slate-400">inconnu</span>
              )}
            </td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">{h.address ?? '—'}</td>
            <td className="px-3 py-2 text-slate-500">{h.server ?? '—'}</td>
            <td className="px-3 py-2 text-slate-500">{h.idleTime ?? '—'}</td>
          </tr>
        )}
      />
    </div>
  );
}

export function IpBindingsTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['ip-bindings', currentId],
    queryFn: () => hotspotTabsApi.ipBindings(currentId),
  });

  const TON: Record<string, 'green' | 'amber' | 'slate' | 'red'> = {
    bypassed: 'green',
    blocked: 'red',
    regular: 'slate',
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Les appareils qui contournent le portail, et ceux qu'on bloque. Le contournement sert à ce
        qui ne peut pas afficher une page de connexion ; le blocage coupe un appareil sans toucher
        au compte.
      </p>
      <Liste
        requête={requête}
        colonnes={['Adresse MAC', 'Adresse IP', 'Traitement', 'Serveur', 'Commentaire']}
        vide={{
          titre: 'Aucune liaison',
          aide: 'Les contournements se posent depuis l\'écran Appareils.',
        }}
        ligne={(b) => (
          <tr key={b.id}>
            <td className="px-3 py-2 font-mono text-xs">{b.macAddress}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">{b.address ?? '—'}</td>
            <td className="px-3 py-2">
              <Badge tone={TON[b.type] ?? 'slate'}>{b.type}</Badge>
            </td>
            <td className="px-3 py-2 text-slate-500">{b.server ?? '—'}</td>
            <td className="max-w-xs truncate px-3 py-2 text-xs text-slate-500">
              {b.comment ?? '—'}
            </td>
          </tr>
        )}
      />
    </div>
  );
}

export function UmSessionsTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['um-sessions', currentId],
    queryFn: () => umTabsApi.sessions(currentId),
  });
  const { terme, setTerme, filtrés } = useFiltre(requête.data, (s) => [
    s.username,
    s.callingStationId,
  ]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Les authentifications vues par RADIUS. Une session ouverte par cookie n'y figure pas —
        elle n'est jamais passée par RADIUS, et c'est précisément le trou que la coupure d'accès
        doit fermer.
      </p>
      <Input
        value={terme}
        onChange={(e) => setTerme(e.target.value)}
        placeholder="Filtrer par compte ou adresse MAC"
        className="max-w-sm"
      />
      <Liste
        requête={{ ...requête, data: filtrés }}
        colonnes={['Compte', 'Appareil', 'Début', 'Fin', 'Durée', 'État']}
        vide={{ titre: 'Aucune session', aide: 'Aucune authentification enregistrée.' }}
        ligne={(s) => (
          <tr key={s.id}>
            <td className="px-3 py-2 font-mono text-xs">{s.username}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">
              {s.callingStationId ?? '—'}
            </td>
            <td className="px-3 py-2 text-xs text-slate-500">{s.startTime ?? '—'}</td>
            <td className="px-3 py-2 text-xs text-slate-500">{s.endTime ?? '—'}</td>
            <td className="px-3 py-2 tabular-nums">{formatDuree(s.uptimeSeconds)}</td>
            <td className="px-3 py-2">
              <Badge tone={s.active ? 'green' : 'slate'}>{s.active ? 'en cours' : 'terminée'}</Badge>
            </td>
          </tr>
        )}
      />
    </div>
  );
}

export function UmAssignmentsTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['um-assignments', currentId],
    queryFn: () => umTabsApi.assignments(currentId),
  });

  const TON: Record<string, 'green' | 'amber' | 'slate' | 'red'> = {
    'running-active': 'green',
    running: 'green',
    waiting: 'amber',
    used: 'slate',
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        C'est ici que vit l'échéance réelle : le routeur la tient et l'applique, même cette
        application arrêtée. Un compte peut en porter plusieurs — un rachat en ajoute une, il ne
        remplace pas la précédente.
      </p>
      <Liste
        requête={requête}
        colonnes={['Compte', 'Profil', 'Expire le', 'État']}
        vide={{
          titre: 'Aucune attribution',
          aide: 'Un compte reçoit son attribution à la première authentification.',
        }}
        ligne={(a) => (
          <tr key={a.id}>
            <td className="px-3 py-2 font-mono text-xs">{a.username}</td>
            <td className="px-3 py-2">{a.profileName}</td>
            <td className="px-3 py-2 text-slate-500">{a.endTime ?? '—'}</td>
            <td className="px-3 py-2">
              <Badge tone={TON[a.state] ?? 'slate'}>{a.state}</Badge>
            </td>
          </tr>
        )}
      />
    </div>
  );
}
