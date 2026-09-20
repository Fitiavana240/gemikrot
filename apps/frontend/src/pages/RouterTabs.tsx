import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatDebit,
  formatDuree,
  formatOctets,
  hotspotTabsApi,
  umTabsApi,
  type CreateHotspotUser,
  type HotspotUser,
  type UpdateHotspotUser,
} from '../api/mikrotik-tabs';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { useRouterSelection } from '../routers/RouterContext';
import { GenerationTickets } from '../components/GenerationTickets';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  FormField,
  Input,
  Select,
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

/**
 * Le formulaire d'un compte HotSpot, en création comme en modification.
 *
 * Il reprend l'écran de WinBox en retirant ce que le parc n'utilise pas :
 * sur ses 646 comptes, **aucun** ne porte d'adresse MAC, d'adresse fixe, de
 * courriel, de route ni de secret OTP. Les proposer ferait six champs vides à
 * traverser pour en remplir trois.
 *
 * Le plafond est saisi en heures parce que c'est ainsi qu'un ticket se vend
 * — « 2h, 500 Ar ». RouterOS le stocke en durée, pas en nombre.
 */
function FormulaireCompteHotspot({
  compte,
  profils,
  onValider,
  onAnnuler,
  enCours,
}: {
  compte?: HotspotUser;
  profils: string[];
  onValider: (valeurs: {
    username: string;
    password: string;
    profileName: string;
    comment: string;
    limitUptimeSeconds: number | null;
  }) => void;
  onAnnuler: () => void;
  enCours: boolean;
}) {
  const modification = compte != null;
  const [username, setUsername] = useState(compte?.username ?? '');
  const [password, setPassword] = useState('');
  const [profileName, setProfileName] = useState(compte?.profile ?? '');
  const [comment, setComment] = useState(compte?.comment ?? '');
  const [heures, setHeures] = useState(
    compte?.limitUptimeSeconds != null ? String(compte.limitUptimeSeconds / 3600) : '',
  );

  return (
    <Card title={modification ? `Modifier « ${compte.username} »` : 'Nouveau compte HotSpot'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const h = heures.trim() === '' ? null : Number(heures.replace(',', '.'));
          onValider({
            username,
            password,
            profileName,
            comment,
            // Vide veut dire « aucun plafond », pas « zéro heure » — un
            // plafond nul créerait un compte inutilisable dès sa création.
            limitUptimeSeconds: h != null && Number.isFinite(h) && h > 0 ? Math.round(h * 3600) : null,
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Nom du compte">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={modification}
              placeholder="H828018"
            />
          </FormField>
          <FormField label={modification ? 'Nouveau mot de passe' : 'Mot de passe'}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={!modification}
              placeholder={modification ? 'laisser vide pour ne pas changer' : ''}
            />
          </FormField>
          <FormField label="Profil">
            <Select
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              required
            >
              <option value="">— choisir —</option>
              {profils.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Client (commentaire)">
            {/* Sur ce parc, le commentaire porte le nom de la personne :
                c'est le seul lien entre un compte et quelqu'un. */}
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Ticket 500Ar"
            />
          </FormField>
          <FormField label="Plafond de temps (heures)">
            <Input
              type="number"
              min="0"
              step="0.5"
              value={heures}
              onChange={(e) => setHeures(e.target.value)}
              placeholder="vide = sans plafond"
            />
          </FormField>
        </div>
        <p className="max-w-3xl text-xs text-slate-500">
          Le plafond compte le temps passé connecté : il s'arrête quand le client se déconnecte
          et reprend à sa reconnexion. Pour une validité qui court même hors ligne, il faut un
          forfait User Manager.
        </p>
        <div className="flex gap-2">
          <Button type="submit" disabled={enCours}>
            {enCours ? 'Enregistrement…' : modification ? 'Enregistrer' : 'Créer le compte'}
          </Button>
          <Button type="button" variant="secondary" onClick={onAnnuler}>
            Annuler
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function HotspotUsersTab() {
  const { currentId } = useRouterSelection();
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const [àSupprimer, setÀSupprimer] = useState<string | null>(null);
  const [formulaire, setFormulaire] = useState<'aucun' | 'creation' | HotspotUser>('aucun');

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

  const profils = useQuery({
    queryKey: ['hotspot-profiles', currentId],
    queryFn: () => hotspotTabsApi.profiles(currentId),
  });

  const créer = useMutation({
    mutationFn: (dto: CreateHotspotUser) => hotspotTabsApi.createUser(dto, currentId),
    onSuccess: () => {
      setFormulaire('aucun');
      rafraîchir();
    },
    onError,
  });
  const modifier = useMutation({
    mutationFn: ({ username, dto }: { username: string; dto: UpdateHotspotUser }) =>
      hotspotTabsApi.updateUser(username, dto, currentId),
    onSuccess: () => {
      setFormulaire('aucun');
      rafraîchir();
    },
    onError,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-600">
          La table du HotSpot lui-même. Un compte d'ici n'expire pas à une date : son plafond
          compte le <strong>temps passé connecté</strong> et s'arrête quand le client se
          déconnecte — c'est l'inverse d'un forfait User Manager, calendaire. Le trafic affiché
          est cumulé depuis la création du compte.
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm text-slate-500">{filtrés.length} compte(s)</span>
          {canWrite && formulaire === 'aucun' && (
            <Button onClick={() => setFormulaire('creation')}>Nouveau compte</Button>
          )}
        </div>
      </div>

      {formulaire !== 'aucun' && (
        <FormulaireCompteHotspot
          compte={formulaire === 'creation' ? undefined : formulaire}
          profils={(profils.data ?? []).map((p) => p.name)}
          enCours={créer.isPending || modifier.isPending}
          onAnnuler={() => setFormulaire('aucun')}
          onValider={(v) => {
            if (formulaire === 'creation') {
              créer.mutate({
                username: v.username,
                password: v.password,
                profileName: v.profileName,
                ...(v.comment ? { comment: v.comment } : {}),
                ...(v.limitUptimeSeconds != null
                  ? { limitUptimeSeconds: v.limitUptimeSeconds }
                  : {}),
              });
              return;
            }
            // Seuls les champs changés : renvoyer tout écraserait le profil
            // ou le plafond avec ce que le formulaire avait chargé.
            const dto: UpdateHotspotUser = {};
            if (v.password) dto.password = v.password;
            if (v.profileName !== formulaire.profile) dto.profileName = v.profileName;
            if (v.comment !== (formulaire.comment ?? '')) dto.comment = v.comment;
            if (v.limitUptimeSeconds !== formulaire.limitUptimeSeconds) {
              dto.limitUptimeSeconds = v.limitUptimeSeconds;
            }
            if (Object.keys(dto).length === 0) {
              setFormulaire('aucun');
              return;
            }
            modifier.mutate({ username: formulaire.username, dto });
          }}
        />
      )}

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
                  <Button variant="secondary" onClick={() => setFormulaire(u)}>
                    Modifier
                  </Button>
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
  const { canWrite } = useAuth();
  const [àGenerer, setÀGenerer] = useState<string | null>(null);
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

      {àGenerer && currentId && (
        <GenerationTickets
          routerId={currentId}
          cible="hotspot"
          profileName={àGenerer}
          onFermer={() => setÀGenerer(null)}
        />
      )}

      <Liste
        requête={requête}
        colonnes={['Profil', 'Descendant', 'Montant', 'Durée de session', 'Appareils', '']}
        vide={{ titre: 'Aucun profil HotSpot' }}
        ligne={(p) => (
          <tr key={p.id}>
            <td className="px-3 py-2 font-medium">{p.name}</td>
            <td className="px-3 py-2 tabular-nums">{formatDebit(p.rateLimitRxBitsPerSecond)}</td>
            <td className="px-3 py-2 tabular-nums">{formatDebit(p.rateLimitTxBitsPerSecond)}</td>
            <td className="px-3 py-2 tabular-nums">{formatDuree(p.sessionTimeoutSeconds)}</td>
            <td className="px-3 py-2 tabular-nums">{p.sharedUsers}</td>
            <td className="px-3 py-2 text-right">
              {canWrite && <Button onClick={() => setÀGenerer(p.name)}>Générer</Button>}
            </td>
          </tr>
        )}
      />
    </div>
  );
}

/**
 * Les paiements notés par le routeur lui-même.
 *
 * À ne pas confondre avec l'écran Paiements de l'application, qui est la
 * source de vérité commerciale. Ceci n'est que la fonction de paiement
 * intégrée de RouterOS — que ce parc n'utilise pas, puisqu'il encaisse par
 * Mobile Money hors du routeur. La table sera donc vide, et c'est normal :
 * l'écran le dit plutôt que de laisser croire à une panne.
 */
export function UmPaymentsTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['um-payments', currentId],
    queryFn: () => umTabsApi.payments(currentId),
  });

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Ce que le routeur a noté lui-même, par sa fonction de paiement intégrée. Ce n'est pas la
        comptabilité de la console : les encaissements Mobile Money se suivent dans{' '}
        <strong>Vendre ▸ Paiements</strong>.
      </p>
      {/* Les noms de champs viennent des colonnes de WinBox et non d'un
          relevé : la collection répond `200` mais reste vide sur ce parc.
          Le dire évite qu'une colonne vide passe pour une panne. */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>Table non vérifiée sur matériel.</strong> Elle répond, mais elle est vide ici —
        le paiement intégré de RouterOS n'est pas utilisé. Si des lignes apparaissent un jour
        avec des colonnes vides, ce sont les noms de champs qu'il faudra corriger, pas le
        routeur.
      </div>
      <Liste
        requête={requête}
        colonnes={['Compte', 'Profil', 'Prix', 'Devise', 'Début', 'Fin', 'État']}
        vide={{
          titre: 'Aucun paiement enregistré par le routeur',
          aide: "C'est attendu : les encaissements passent par Mobile Money, hors du routeur.",
        }}
        ligne={(p) => (
          <tr key={p.id}>
            <td className="px-3 py-2 font-medium">{p.username}</td>
            <td className="px-3 py-2 text-slate-500">{p.profileName ?? '—'}</td>
            <td className="px-3 py-2 tabular-nums">{p.price ?? '—'}</td>
            <td className="px-3 py-2 text-slate-500">{p.currency ?? '—'}</td>
            <td className="px-3 py-2 text-xs text-slate-500">{p.transactionStart ?? '—'}</td>
            <td className="px-3 py-2 text-xs text-slate-500">{p.transactionEnd ?? '—'}</td>
            <td className="px-3 py-2">
              {p.transactionStatus ? (
                <Badge tone="slate">{p.transactionStatus}</Badge>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </td>
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

// `IpBindingsTab` a été retiré : il montrait en lecture seule ce que l'écran
// Appareils gère réellement, et son propre état vide renvoyait là-bas. Deux
// tables pour une même chose se contredisent tôt ou tard — celle qui ne sait
// rien changer perd d'avance.

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


export function HotspotServerProfilesTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['hotspot-server-profiles', currentId],
    queryFn: () => hotspotTabsApi.serverProfiles(currentId),
  });

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Le profil de serveur décide <em>comment</em> un client s'authentifie. La ligne qui compte
        est <code>login-by</code> : tant qu'elle contient <code>cookie</code>, un client déjà venu
        se reconnecte sans repasser par RADIUS — donc sans que sa validité soit vérifiée.
      </p>
      <Liste
        requête={requête}
        colonnes={['Profil', "Méthodes d'entrée", 'Durée des cookies', 'RADIUS', 'Adresse']}
        vide={{ titre: 'Aucun profil de serveur' }}
        ligne={(p) => (
          <tr key={p.id}>
            <td className="px-3 py-2 font-medium">{p.name}</td>
            <td className="px-3 py-2">
              <span className="flex flex-wrap gap-1">
                {p.loginBy.map((m) => (
                  // Le cookie est signalé : c'est lui qui rouvre un accès coupé.
                  <Badge key={m} tone={m.includes('cookie') ? 'amber' : 'slate'}>
                    {m}
                  </Badge>
                ))}
              </span>
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {formatDuree(p.httpCookieLifetimeSeconds)}
            </td>
            <td className="px-3 py-2">
              <Badge tone={p.useRadius ? 'green' : 'red'}>{p.useRadius ? 'oui' : 'non'}</Badge>
            </td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">
              {p.hotspotAddress ?? p.dnsName ?? '—'}
            </td>
          </tr>
        )}
      />
    </div>
  );
}

export function HotspotServicePortsTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['hotspot-service-ports', currentId],
    queryFn: () => hotspotTabsApi.servicePorts(currentId),
  });

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Les protocoles dont le HotSpot suit les connexions pour les faire passer correctement au
        travers du portail. Rarement touché : on y vient quand un usage précis ne passe pas.
      </p>
      <Liste
        requête={requête}
        colonnes={['Protocole', 'Ports', 'État']}
        vide={{ titre: 'Aucun port de service' }}
        ligne={(p) => (
          <tr key={p.id}>
            <td className="px-3 py-2 font-medium">{p.name}</td>
            <td className="px-3 py-2 font-mono text-xs">{p.ports || '—'}</td>
            <td className="px-3 py-2">
              <Badge tone={p.disabled ? 'slate' : 'green'}>
                {p.disabled ? 'désactivé' : 'actif'}
              </Badge>
            </td>
          </tr>
        )}
      />
    </div>
  );
}

export function UmRoutersTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['um-routers', currentId],
    queryFn: () => umTabsApi.routers(currentId),
  });

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Les équipements autorisés à interroger ce serveur RADIUS. Sur un parc mono-routeur, le
        routeur s'y déclare lui-même en boucle locale.
      </p>
      <Liste
        requête={requête}
        colonnes={['Nom', 'Adresse', 'Protocole', 'Port de changement', 'Secret', 'État']}
        vide={{ titre: 'Aucun client RADIUS déclaré' }}
        ligne={(r) => (
          <tr key={r.id}>
            <td className="px-3 py-2 font-medium">{r.name}</td>
            <td className="px-3 py-2 font-mono text-xs">{r.address}</td>
            <td className="px-3 py-2 text-slate-500">{r.protocol}</td>
            <td className="px-3 py-2 tabular-nums text-slate-500">{r.coaPort ?? '—'}</td>
            <td className="px-3 py-2">
              {/* La valeur du secret ne quitte jamais le serveur : seule sa
                  présence est rendue. */}
              <Badge tone={r.hasSharedSecret ? 'green' : 'red'}>
                {r.hasSharedSecret ? 'posé' : 'absent'}
              </Badge>
            </td>
            <td className="px-3 py-2">
              <Badge tone={r.disabled ? 'slate' : 'green'}>
                {r.disabled ? 'désactivé' : 'actif'}
              </Badge>
            </td>
          </tr>
        )}
      />
    </div>
  );
}

export function UmUserGroupsTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['um-user-groups', currentId],
    queryFn: () => umTabsApi.userGroups(currentId),
  });

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Les méthodes d'authentification acceptées. « Extérieur » vaut pour l'échange direct,
        « intérieur » pour ce qui passe dans un tunnel chiffré.
      </p>
      <Liste
        requête={requête}
        colonnes={['Groupe', 'Extérieur', 'Intérieur', 'Origine']}
        vide={{ titre: "Aucun groupe d'authentification" }}
        ligne={(g) => (
          <tr key={g.id}>
            <td className="px-3 py-2 font-medium">{g.name}</td>
            <td className="max-w-xs px-3 py-2 text-xs text-slate-600">
              {g.outerAuths.join(', ') || '—'}
            </td>
            <td className="max-w-xs px-3 py-2 text-xs text-slate-600">
              {g.innerAuths.join(', ') || '—'}
            </td>
            <td className="px-3 py-2">
              {/* Un groupe livré avec RouterOS ne se supprime pas : le dire
                  évite de proposer une action qui échouera. */}
              <Badge tone={g.isDefault ? 'slate' : 'green'}>
                {g.isDefault ? 'fourni' : 'créé ici'}
              </Badge>
            </td>
          </tr>
        )}
      />
    </div>
  );
}

export function UmAttributesTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['um-attributes', currentId],
    queryFn: () => umTabsApi.attributes(currentId),
  });
  const { terme, setTerme, filtrés } = useFiltre(requête.data, (a) => [a.name, a.standardName]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-600">
          Le vocabulaire que RADIUS sait échanger. On le consulte pour savoir ce qu'un profil
          peut imposer à une session — rarement pour le modifier.
        </p>
        <span className="shrink-0 text-sm text-slate-500">{filtrés.length} attribut(s)</span>
      </div>
      <Input
        value={terme}
        onChange={(e) => setTerme(e.target.value)}
        placeholder="Filtrer par nom"
        className="max-w-sm"
      />
      <Liste
        requête={{ ...requête, data: filtrés }}
        colonnes={['Attribut', 'Numéro', 'Genre', 'Paquets', 'Origine']}
        vide={{ titre: 'Aucun attribut' }}
        ligne={(a) => (
          <tr key={a.id}>
            <td className="px-3 py-2 font-medium">{a.name}</td>
            <td className="px-3 py-2 tabular-nums text-slate-500">{a.typeId ?? '—'}</td>
            <td className="px-3 py-2 text-slate-500">{a.valueType ?? '—'}</td>
            <td className="max-w-xs truncate px-3 py-2 text-xs text-slate-500">
              {a.packetTypes.join(', ') || '—'}
            </td>
            <td className="px-3 py-2">
              <Badge tone={a.vendorId ? 'amber' : 'slate'}>
                {a.vendorId ? `constructeur ${a.vendorId}` : 'standard'}
              </Badge>
            </td>
          </tr>
        )}
      />
    </div>
  );
}
