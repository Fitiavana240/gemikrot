import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatDebit,
  formatDuree,
  formatOctets,
  hotspotTabsApi,
  umTabsApi,
  type CreateHotspotUser,
  type HotspotProfile,
  type HotspotUser,
  type UpdateHotspotProfile,
  type UpdateHotspotUser,
} from '../api/mikrotik-tabs';
import { userManagerApi } from '../api/user-manager';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { phraseCoupure } from '../api/coupure';
import { formatDuration } from '../api/user-manager';
import { ListeDuRouteur } from '../components/ListeDuRouteur';
import { useRouterSelection } from '../routers/RouterContext';
import { GenerationTickets } from '../components/GenerationTickets';
import { ChampDuree } from '../components/Edition';
import { Confirmation } from '../components/Edition';
import { BarreSelection, CaseLigne, useSelection } from '../components/Selection';
import {
  Badge,
  Button,
  Card,
  Compteur,
  ErrorNote,
  FormField,
  Input,
  Select,
} from '../components/ui';

/**
 * Les onglets qui manquaient face à WinBox.
 *
 * Chacun lit le routeur en direct — ce sont des tables du matériel, pas des
 * copies en base. C'est pour cela qu'ils affichent une erreur plutôt qu'un
 * tableau vide quand le routeur ne répond pas : un vide serait un mensonge.
 */


/** Filtre en mémoire : ces tables tiennent en quelques centaines de lignes. */
/** Octets → gigaoctets pour la saisie. Vide quand il n'y a pas de plafond. */
function enGo(octets: number | null | undefined): string {
  if (!octets) return '';
  return String(Math.round((octets / 1_073_741_824) * 100) / 100);
}

/**
 * Gigaoctets saisis → octets, ou `null`.
 *
 * Un champ vide veut dire « aucun plafond » et non « zéro » : un plafond nul
 * rendrait le compte inutilisable dès le premier octet.
 */
function enOctets(valeur: string): number | null {
  const nombre = Number(valeur);
  if (!valeur.trim() || !Number.isFinite(nombre) || nombre <= 0) return null;
  return Math.round(nombre * 1_073_741_824);
}

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
 * Le plafond porte son unité : les tickets du parc vont de 2 h à un mois, et
 * une unité fixe obligerait à saisir « 720 » pour l'un ou « 0.25 » pour
 * l'autre. RouterOS le stocke en durée, pas en nombre.
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
    limitBytesIn: number | null;
    limitBytesOut: number | null;
    limitBytesTotal: number | null;
  }) => void;
  onAnnuler: () => void;
  enCours: boolean;
}) {
  const modification = compte != null;
  const [username, setUsername] = useState(compte?.username ?? '');
  const [password, setPassword] = useState('');
  const [profileName, setProfileName] = useState(compte?.profile ?? '');
  const [comment, setComment] = useState(compte?.comment ?? '');
  const [plafond, setPlafond] = useState<number | null>(compte?.limitUptimeSeconds ?? null);
  // Les quotas se saisissent en gigaoctets : personne ne compte en octets au
  // comptoir, et RouterOS les stocke de toute façon en octets.
  const [quotaReçu, setQuotaReçu] = useState<string>(enGo(compte?.limitBytesIn));
  const [quotaEnvoyé, setQuotaEnvoyé] = useState<string>(enGo(compte?.limitBytesOut));
  const [quotaTotal, setQuotaTotal] = useState<string>(enGo(compte?.limitBytesTotal));

  return (
    <Card title={modification ? `Modifier « ${compte.username} »` : 'Nouveau compte HotSpot'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onValider({
            username,
            password,
            profileName,
            comment,
            // `null` veut dire « aucun plafond », pas « zéro » — un plafond
            // nul créerait un compte inutilisable dès sa création.
            limitUptimeSeconds: plafond,
            limitBytesIn: enOctets(quotaReçu),
            limitBytesOut: enOctets(quotaEnvoyé),
            limitBytesTotal: enOctets(quotaTotal),
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
          <FormField label="Volume reçu (Go)">
            <Input
              type="number"
              min={0}
              step="0.1"
              value={quotaReçu}
              onChange={(e) => setQuotaReçu(e.target.value)}
              placeholder="sans plafond"
            />
          </FormField>
          <FormField label="Volume envoyé (Go)">
            <Input
              type="number"
              min={0}
              step="0.1"
              value={quotaEnvoyé}
              onChange={(e) => setQuotaEnvoyé(e.target.value)}
              placeholder="sans plafond"
            />
          </FormField>
          <FormField label="Volume total (Go)">
            {/* Distinct de la somme des deux : RouterOS applique les trois
                indépendamment, et le premier atteint coupe. */}
            <Input
              type="number"
              min={0}
              step="0.1"
              value={quotaTotal}
              onChange={(e) => setQuotaTotal(e.target.value)}
              placeholder="sans plafond"
            />
          </FormField>
          <FormField label="Plafond de temps">
            {/* Les tickets du parc vont de 2 h à un mois : une unité fixe
                obligerait à saisir « 720 » pour l'un ou « 0.25 » pour
                l'autre. Vide veut dire « aucun plafond », pas zéro. */}
            <ChampDuree
              secondes={plafond}
              onChange={setPlafond}
              placeholder="sans plafond"
            />
          </FormField>
        </div>
        <p className="max-w-3xl text-xs text-slate-500">
          Le plafond compte le temps passé connecté : il s'arrête quand le client se déconnecte
          et reprend à sa reconnexion. Pour une validité qui court même hors ligne, il faut un
          forfait User Manager.
        </p>
        <p className="max-w-3xl text-xs text-slate-500">
          Ces quatre plafonds appartiennent <strong>au compte</strong>, pas au profil : celui-ci
          borne une session, ceux-là bornent l'accès vendu. On peut donc faire un ticket
          particulier sans créer de profil pour lui. Laisser vide veut dire « aucun plafond ».
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
  const [compteRendu, setCompteRendu] = useState<string | null>(null);
  /** Le geste demandé sur une ligne, tant qu'il n'est pas confirmé. */
  const [àConfirmer, setÀConfirmer] = useState<{
    geste: 'bloquer' | 'debloquer' | 'supprimer';
    compte: string;
  } | null>(null);
  /** Le geste demandé sur le lot coché, tant qu'il n'est pas confirmé. */
  const [enLot, setEnLot] = useState<'bloquer' | 'debloquer' | 'supprimer' | null>(null);
  /**
   * La pose en masse des plafonds, tant qu'elle n'est pas confirmée.
   *
   * Ce bouton écrivait sur N comptes du routeur sur **un seul clic**. C'est
   * exactement la forme qui a déjà fait partir 221 écritures par accident,
   * effaçant au passage l'historique de configuration du routeur.
   */
  const [confirmerPlafonds, setConfirmerPlafonds] = useState(false);
  const [formulaire, setFormulaire] = useState<'aucun' | 'creation' | HotspotUser>('aucun');

  const requête = useQuery({
    queryKey: ['hotspot-users', currentId],
    queryFn: () => hotspotTabsApi.users(currentId),
  });
  // Les profils portent la durée vendue : c'est à eux qu'on compare.
  const profilsDuRouteur = useQuery({
    queryKey: ['hotspot-profiles', currentId],
    queryFn: () => hotspotTabsApi.profiles(currentId),
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
    setCompteRendu(null);
    void queryClient.invalidateQueries({ queryKey: ['hotspot-users', currentId] });
  };

  /**
   * Bloquer coupe pour de bon, et le dit.
   *
   * Le serveur ferme désormais la session en cours et efface les cookies du
   * compte — sans quoi le client restait en ligne, et son `mac-cookie` le
   * laissait revenir pendant trois jours. Le compte rendu n'est pas une
   * coquetterie : c'est ce qui permet de vérifier que le client est hors
   * ligne, plutôt que de le supposer.
   */
  /**
   * Les comptes vendus sous une durée, mais sans plafond de temps cumulé.
   *
   * Le `session-timeout` du profil **repart à zéro à chaque reconnexion**, et
   * le `mac-cookie` rend cette reconnexion automatique : seul `limit-uptime`
   * borne vraiment un ticket. Relevé sur ce parc : 228 tickets « 2 heures »
   * invendus n'en portaient aucun. Le correctif de la génération ne vaut que
   * pour les suivants — ceux-là sont déjà dans le tiroir.
   */
  const duréeDuProfil = new Map(
    (profilsDuRouteur.data ?? []).map((p) => [p.name, p.sessionTimeoutSeconds]),
  );
  const sansPlafond = (requête.data ?? []).filter(
    (u) => u.limitUptimeSeconds === null && (duréeDuProfil.get(u.profile) ?? null) !== null,
  );
  const [pose, setPose] = useState<{ faits: number; total: number } | null>(null);

  /**
   * Le détail par profil, plutôt qu'un seul nombre.
   *
   * « 242 comptes » recouvre des cas qui n'ont pas le même poids : 228 tickets
   * horaires invendus, où le plafond manquant se paie en heures offertes, et
   * une douzaine d'abonnements au mois, où poser trente jours de temps
   * **connecté** ne changera rien en pratique. L'exploitant doit voir ce qu'il
   * s'apprête à écrire avant de l'écrire.
   */
  const sansPlafondParProfil = [...sansPlafond.reduce((acc, u) => {
    acc.set(u.profile, (acc.get(u.profile) ?? 0) + 1);
    return acc;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  const poserLesPlafonds = useMutation({
    mutationFn: async (comptes: HotspotUser[]) => {
      let faits = 0;
      for (const compte of comptes) {
        const durée = duréeDuProfil.get(compte.profile);
        if (!durée) continue;
        // Un par un, et sans s'arrêter sur un échec : 228 écritures sur un
        // routeur lent, mieux vaut en poser 227 que zéro.
        try {
          await hotspotTabsApi.updateUser(
            compte.username,
            { limitUptimeSeconds: durée },
            currentId,
          );
          faits += 1;
        } catch {
          /* compte disparu entre-temps : on continue */
        }
        setPose({ faits, total: comptes.length });
      }
      return faits;
    },
    onSuccess: (faits) => {
      setPose(null);
      setConfirmerPlafonds(false);
      setCompteRendu(`Plafond posé sur ${faits} compte(s).`);
      rafraîchir();
    },
    onError,
  });

  const bloquer = useMutation({
    mutationFn: ({ username, disabled }: { username: string; disabled: boolean }) =>
      hotspotTabsApi.setUserDisabled(username, disabled, currentId),
    onSuccess: (compte) => {
      setÀConfirmer(null);
      rafraîchir();
      setCompteRendu(phraseCoupure(compte.coupure));
    },
    onError,
  });
  const supprimer = useMutation({
    mutationFn: (username: string) => hotspotTabsApi.deleteUser(username, currentId),
    onSuccess: () => {
      setÀConfirmer(null);
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

  const selection = useSelection(filtrés.map((u) => u.username));
  const choisis = filtrés.filter((u) => selection.estChoisie(u.username));

  /**
   * Un compte à la fois, et on continue après un échec.
   *
   * RouterOS n'a pas d'écriture en lot : ce sont N appels. S'arrêter au
   * premier refus laisserait la moitié du lot traité sans qu'on sache
   * laquelle — on va donc au bout et on rend le compte rendu.
   */
  const lot = useMutation({
    mutationFn: async (geste: 'bloquer' | 'debloquer' | 'supprimer') => {
      const échecs: string[] = [];
      for (const compte of choisis) {
        try {
          if (geste === 'supprimer') {
            await hotspotTabsApi.deleteUser(compte.username, currentId);
          } else {
            await hotspotTabsApi.setUserDisabled(
              compte.username,
              geste === 'bloquer',
              currentId,
            );
          }
        } catch {
          échecs.push(compte.username);
        }
      }
      return échecs;
    },
    onSuccess: (échecs) => {
      const total = choisis.length;
      setEnLot(null);
      selection.vider();
      rafraîchir();
      setCompteRendu(
        échecs.length === 0
          ? `${total} compte(s) traité(s).`
          : `${échecs.length} compte(s) sur ${total} n’ont pas abouti : ${échecs.slice(0, 8).join(', ')}${échecs.length > 8 ? '…' : ''}`,
      );
    },
    onError,
  });

  const VERBE_LOT = {
    bloquer: 'bloquer',
    debloquer: 'débloquer',
    supprimer: 'supprimer',
  } as const;

  // Les sélections groupées. Chacune dit son nombre avant qu'on clique.
  const parProfil = [...new Set(filtrés.map((u) => u.profile).filter(Boolean))].map((nom) => ({
    libellé: nom,
    clés: filtrés.filter((u) => u.profile === nom).map((u) => u.username),
  }));
  const parEtat = [
    { libellé: 'bloqués', clés: filtrés.filter((u) => u.disabled).map((u) => u.username) },
    { libellé: 'actifs', clés: filtrés.filter((u) => !u.disabled).map((u) => u.username) },
    {
      libellé: 'jamais utilisés',
      clés: filtrés.filter((u) => u.uptimeSeconds === 0).map((u) => u.username),
    },
    {
      libellé: 'sans plafond de durée',
      clés: filtrés.filter((u) => u.limitUptimeSeconds == null).map((u) => u.username),
    },
  ];

  return (
    <div className="space-y-2">
      {/* La barre d'outils d'abord, et rien avant : l'explication est en bas,
          sinon la table commence à mi-écran et il faut défiler pour la voir. */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
          placeholder="Filtrer par nom, profil ou commentaire"
          className="max-w-sm"
        />
        <Compteur requête={requête} nombre={filtrés.length} unité="compte(s)" />
        {canWrite && formulaire === 'aucun' && (
          <Button className="ml-auto" onClick={() => setFormulaire('creation')}>
            Nouveau compte
          </Button>
        )}
      </div>

      {canWrite && filtrés.length > 0 && (
        <BarreSelection
          nombre={selection.nombre}
          total={filtrés.length}
          onTout={() => selection.poser(filtrés.map((u) => u.username))}
          onRien={selection.vider}
          onChoisir={selection.poser}
          groupes={[
            { titre: 'Par profil', entrées: parProfil },
            { titre: 'Par état', entrées: parEtat },
          ]}
          actions={
            <>
              <Button variant="secondary" onClick={() => setEnLot('bloquer')}>
                Bloquer{selection.nombre > 1 ? ` les ${selection.nombre}` : ''}
              </Button>
              <Button variant="secondary" onClick={() => setEnLot('debloquer')}>
                Débloquer{selection.nombre > 1 ? ` les ${selection.nombre}` : ''}
              </Button>
              <Button variant="danger" onClick={() => setEnLot('supprimer')}>
                Supprimer{selection.nombre > 1 ? ` les ${selection.nombre}` : ''}
              </Button>
            </>
          }
        />
      )}

      {enLot && (
        <Confirmation
          titre={`Voulez-vous vraiment ${VERBE_LOT[enLot]} ${selection.nombre} compte${selection.nombre > 1 ? 's' : ''} ?`}
          enCours={lot.isPending}
          erreur={lot.isError ? erreur : null}
          onAnnuler={() => {
            setErreur(null);
            setEnLot(null);
          }}
          onConfirmer={() => lot.mutate(enLot)}
        >
          {/* Le nombre ne se vérifie pas, les noms si. */}
          <p className="font-mono text-xs">
            {choisis
              .slice(0, 12)
              .map((u) => u.username)
              .join(', ')}
            {choisis.length > 12 && ` … et ${choisis.length - 12} autres`}
          </p>
          <p className="mt-2">
            {enLot === 'supprimer' ? (
              <>
                Leur trafic consommé et leur commentaire partent avec, sans retour possible —
                et le commentaire est souvent le seul lien entre un compte et une personne.
              </>
            ) : enLot === 'bloquer' ? (
              <>
                Les comptes restent et gardent tout ; ils cessent d&apos;être acceptés. Une
                session déjà ouverte ne se ferme pas d&apos;elle-même.
              </>
            ) : (
              <>Les comptes seront de nouveau acceptés, avec leurs compteurs inchangés.</>
            )}
          </p>
          {selection.nombre > 1 && (
            <p className="mt-2 text-slate-500">
              Le routeur ne sait pas écrire en lot : ce sont {selection.nombre} écritures qui
              partent l&apos;une après l&apos;autre. Un refus sur l&apos;une n&apos;arrête pas
              les autres, et le compte rendu nomme celles qui ont échoué.
            </p>
          )}
        </Confirmation>
      )}

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
                // Omis quand il n'y a pas de plafond : un zéro posé à la
                // création rendrait le compte inutilisable dès le premier octet.
                ...(v.limitBytesIn != null ? { limitBytesIn: v.limitBytesIn } : {}),
                ...(v.limitBytesOut != null ? { limitBytesOut: v.limitBytesOut } : {}),
                ...(v.limitBytesTotal != null ? { limitBytesTotal: v.limitBytesTotal } : {}),
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
            if (v.limitBytesIn !== formulaire.limitBytesIn) dto.limitBytesIn = v.limitBytesIn;
            if (v.limitBytesOut !== formulaire.limitBytesOut) dto.limitBytesOut = v.limitBytesOut;
            if (v.limitBytesTotal !== formulaire.limitBytesTotal) {
              dto.limitBytesTotal = v.limitBytesTotal;
            }
            if (Object.keys(dto).length === 0) {
              setFormulaire('aucun');
              return;
            }
            modifier.mutate({ username: formulaire.username, dto });
          }}
        />
      )}

      {erreur && <ErrorNote>{erreur}</ErrorNote>}
      {compteRendu && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {compteRendu}
        </p>
      )}

      {confirmerPlafonds && (
        <Confirmation
          titre={`Écrire un plafond sur ${sansPlafond.length} compte(s) du routeur`}
          libelléConfirmer={`Poser les ${sansPlafond.length} plafonds`}
          enCours={poserLesPlafonds.isPending}
          erreur={poserLesPlafonds.isError ? erreur : null}
          onAnnuler={() => {
            setErreur(null);
            setConfirmerPlafonds(false);
          }}
          onConfirmer={() => poserLesPlafonds.mutate(sansPlafond)}
        >
          Chaque compte reçoit la durée de son profil en plafond de temps cumulé : il
          s&apos;arrêtera pour de bon au bout, au lieu de se rejouer indéfiniment.{' '}
          <strong>Ce sont {sansPlafond.length} écritures sur le routeur</strong>, une par
          compte, et il n&apos;y a pas de retour en arrière automatique — défaire supposerait
          de retirer le plafond compte par compte.
        </Confirmation>
      )}

      {àConfirmer && (
        <Confirmation
          titre={
            àConfirmer.geste === 'supprimer'
              ? `Voulez-vous vraiment supprimer « ${àConfirmer.compte} » ?`
              : àConfirmer.geste === 'bloquer'
                ? `Voulez-vous vraiment bloquer « ${àConfirmer.compte} » ?`
                : `Voulez-vous vraiment débloquer « ${àConfirmer.compte} » ?`
          }
          enCours={bloquer.isPending || supprimer.isPending}
          erreur={bloquer.isError || supprimer.isError ? erreur : null}
          onAnnuler={() => {
            setErreur(null);
            setÀConfirmer(null);
          }}
          onConfirmer={() => {
            setErreur(null);
            if (àConfirmer.geste === 'supprimer') supprimer.mutate(àConfirmer.compte);
            else
              bloquer.mutate({
                username: àConfirmer.compte,
                disabled: àConfirmer.geste === 'bloquer',
              });
          }}
        >
          {àConfirmer.geste === 'supprimer' ? (
            <>
              Son trafic consommé et son commentaire partent avec, sans retour possible. Le
              bloquer suffit le plus souvent.
            </>
          ) : àConfirmer.geste === 'bloquer' ? (
            <>
              Le compte reste et garde son trafic consommé ; il cesse d&apos;être accepté.
              C&apos;est ce que montre la croix dans WinBox : un geste délibéré, pas une
              expiration.
            </>
          ) : (
            <>
              Le compte répondra de nouveau. Son plafond de temps cumulé, lui, a gardé ce qui
              avait déjà été consommé.
            </>
          )}
        </Confirmation>
      )}

      <ListeDuRouteur
        requête={{ ...requête, data: filtrés }}
        colonnes={[
          ...(canWrite ? [''] : []),
          'Compte',
          'Client',
          'Profil',
          'Durée',
          'Reçu',
          'Envoyé',
          'Plafond total',
          'État',
          '',
        ]}
        vide={{ titre: 'Aucun compte HotSpot', aide: 'Cette table est vide sur le routeur.' }}
        ligne={(u) => (
          <tr
            key={u.id}
            className={
              selection.estChoisie(u.username)
                ? 'bg-sky-50'
                : u.disabled
                  ? 'opacity-60'
                  : undefined
            }
          >
            {canWrite && (
              <CaseLigne
                cochée={selection.estChoisie(u.username)}
                libellé={u.username}
                onBasculer={(avecMaj) => selection.basculer(u.username, avecMaj)}
              />
            )}
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
            {/* Consommé et plafond côte à côte, comme pour la durée : un seul
                chiffre laisse croire qu'il n'y a pas de borne, alors que le
                compte peut en porter une que le profil ignore. */}
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {formatOctets(u.bytesIn)}
              {u.limitBytesIn != null && (
                <span className="text-slate-400"> / {formatOctets(u.limitBytesIn)}</span>
              )}
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {formatOctets(u.bytesOut)}
              {u.limitBytesOut != null && (
                <span className="text-slate-400"> / {formatOctets(u.limitBytesOut)}</span>
              )}
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {u.limitBytesTotal != null ? formatOctets(u.limitBytesTotal) : '—'}
            </td>
            <td className="px-3 py-2">
              <Badge tone={u.disabled ? 'red' : 'green'}>
                {u.disabled ? 'bloqué' : 'actif'}
              </Badge>
            </td>
            <td className="space-x-2 whitespace-nowrap px-3 py-2 text-right">
              {/* Les boutons restent sur la ligne ; aucun n'écrit au clic. */}
              {canWrite && (
                <>
                  <Button variant="secondary" onClick={() => setFormulaire(u)}>
                    Modifier
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={bloquer.isPending}
                    onClick={() =>
                      setÀConfirmer({
                        geste: u.disabled ? 'debloquer' : 'bloquer',
                        compte: u.username,
                      })
                    }
                  >
                    {u.disabled ? 'Débloquer' : 'Bloquer'}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setÀConfirmer({ geste: 'supprimer', compte: u.username })}
                  >
                    Supprimer
                  </Button>
                </>
              )}
            </td>
          </tr>
        )}
      />

      {sansPlafond.length > 0 && (
        <Card title={`${sansPlafond.length} compte(s) sans plafond de temps cumulé`}>
          <p className="text-sm text-slate-600">
            Leur profil annonce une durée, mais rien ne la fait respecter :{' '}
            <strong>la durée de session repart à zéro à chaque reconnexion</strong>, et le cookie
            rend cette reconnexion automatique. Un ticket de deux heures peut alors servir deux
            heures par session, sans fin. Poser le plafond reprend la durée écrite sur le profil.
          </p>
          <ul className="mt-2 space-y-0.5 text-sm text-slate-700">
            {sansPlafondParProfil.map(([profil, nombre]) => (
              <li key={profil}>
                <span className="font-medium">{nombre}</span> × {profil} — plafond à poser :{' '}
                {formatDuration(duréeDuProfil.get(profil) ?? 0)}
              </li>
            ))}
          </ul>
          {canWrite && (
            <div className="mt-3 flex items-center gap-3">
              <Button
                variant="danger"
                disabled={poserLesPlafonds.isPending}
                onClick={() => setConfirmerPlafonds(true)}
              >
                {poserLesPlafonds.isPending
                  ? `Écriture… ${pose?.faits ?? 0}/${pose?.total ?? sansPlafond.length}`
                  : `Poser le plafond sur ces ${sansPlafond.length} compte(s)`}
              </Button>
              <span className="text-xs text-slate-500">
                Une écriture par compte sur le routeur : comptez quelques minutes.
              </span>
            </div>
          )}
        </Card>
      )}

      <p className="max-w-3xl text-xs text-slate-500">
        La table du HotSpot lui-même. Un compte d&apos;ici n&apos;expire pas à une date : son
        plafond compte le <strong>temps passé connecté</strong> et s&apos;arrête quand le
        client se déconnecte — c&apos;est l&apos;inverse d&apos;un forfait User Manager, qui
        est calendaire. Le trafic affiché est cumulé depuis la création du compte, et la
        colonne <em>Client</em> vient du commentaire, seul lien entre un compte et quelqu&apos;un.
        {canWrite && (
          <>
            {' '}
            Cochez des lignes pour agir sur plusieurs comptes à la fois ; <strong>Maj+clic</strong>{' '}
            prend toute la plage dans l&apos;ordre affiché.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Modifier un profil HotSpot.
 *
 * Les libellés disent l'effet et non le nom du champ RouterOS : « pose un
 * cookie » ne parle à personne, « le client revient sans retaper son code »
 * décrit ce qui arrivera vraiment au comptoir. Le nom du profil n'est pas
 * modifiable — il identifie le profil côté routeur, et le changer
 * abandonnerait les comptes qui le portent.
 */
function EditionProfilHotspot({
  profil,
  enCours,
  onAnnuler,
  onValider,
}: {
  profil: HotspotProfile;
  enCours: boolean;
  onAnnuler: () => void;
  onValider: (dto: UpdateHotspotProfile) => void;
}) {
  const [form, setForm] = useState<UpdateHotspotProfile>({
    sharedUsers: profil.sharedUsers,
    sessionTimeoutSeconds: profil.sessionTimeoutSeconds ?? undefined,
    idleTimeoutSeconds: profil.idleTimeoutSeconds,
    keepaliveTimeoutSeconds: profil.keepaliveTimeoutSeconds,
    addMacCookie: profil.addMacCookie,
    macCookieTimeoutSeconds: profil.macCookieTimeoutSeconds,
  });

  const cookieTropLong =
    form.addMacCookie === true &&
    form.sessionTimeoutSeconds != null &&
    form.macCookieTimeoutSeconds != null &&
    form.macCookieTimeoutSeconds > form.sessionTimeoutSeconds;

  return (
    <Card title={`Modifier le profil « ${profil.name} »`}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="Appareils simultanés">
          <Input
            type="number"
            min={1}
            value={form.sharedUsers ?? 1}
            onChange={(e) => setForm({ ...form, sharedUsers: Number(e.target.value) || 1 })}
          />
        </FormField>

        <FormField label="Durée d'une session">
          <ChampDuree
            secondes={form.sessionTimeoutSeconds ?? null}
            onChange={(v) => setForm({ ...form, sessionTimeoutSeconds: v ?? undefined })}
          />
        </FormField>

        <FormField label="Inactivité tolérée">
          <ChampDuree
            secondes={form.idleTimeoutSeconds ?? null}
            onChange={(v) => setForm({ ...form, idleTimeoutSeconds: v })}
          />
        </FormField>

        <FormField label="Sans réponse avant fermeture">
          <ChampDuree
            secondes={form.keepaliveTimeoutSeconds ?? null}
            onChange={(v) => setForm({ ...form, keepaliveTimeoutSeconds: v })}
          />
        </FormField>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.addMacCookie ?? false}
            onChange={(e) => setForm({ ...form, addMacCookie: e.target.checked })}
          />
          <span>
            <strong>Le client revient sans retaper son code</strong>
            <span className="block text-slate-600">
              Pratique pour lui, mais sa validité n'est alors <strong>pas vérifiée</strong> : bloquer
              son compte ne le coupe pas tant que ce raccourci dure. Décocher rend le blocage
              immédiat, au prix d'une saisie à chaque reconnexion.
            </span>
          </span>
        </label>

        {form.addMacCookie && (
          <div className="mt-3 max-w-xs">
            <FormField label="Durée de ce raccourci">
              <ChampDuree
                secondes={form.macCookieTimeoutSeconds ?? null}
                onChange={(v) => setForm({ ...form, macCookieTimeoutSeconds: v })}
              />
            </FormField>
            {cookieTropLong && (
              <p className="mt-1.5 text-xs text-red-600">
                Plus long que la session vendue : le client pourra revenir après l'avoir
                épuisée.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <Button disabled={enCours} onClick={() => onValider(form)}>
          {enCours ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
        <Button variant="secondary" onClick={onAnnuler}>
          Annuler
        </Button>
      </div>
    </Card>
  );
}

export function HotspotProfilesTab() {
  const { currentId } = useRouterSelection();
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [àGenerer, setÀGenerer] = useState<string | null>(null);
  const [àModifier, setÀModifier] = useState<HotspotProfile | null>(null);
  const [erreurProfil, setErreurProfil] = useState<string | null>(null);
  const requête = useQuery({
    queryKey: ['hotspot-profiles', currentId],
    queryFn: () => hotspotTabsApi.profiles(currentId),
  });

  const modifier = useMutation({
    mutationFn: ({ name, dto }: { name: string; dto: UpdateHotspotProfile }) =>
      hotspotTabsApi.updateProfile(name, dto, currentId),
    onSuccess: () => {
      setÀModifier(null);
      setErreurProfil(null);
      void queryClient.invalidateQueries({ queryKey: ['hotspot-profiles', currentId] });
    },
    onError: (e) =>
      setErreurProfil(e instanceof ApiError ? e.message : 'Le routeur a refusé cette modification.'),
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Le profil borne le débit et la durée d'<em>une</em> session. Il ne fait pas expirer un
        ticket : la durée repart à zéro à chaque reconnexion. C'est pourquoi les ventes passent
        par User Manager.
      </p>
      <p className="max-w-3xl text-sm text-slate-600">
        La colonne <strong>Cookie</strong> décide de bien plus que son nom ne le laisse croire :
        tant qu'un cookie est posé, un client déjà venu se reconnecte <strong>sans repasser par
        User Manager</strong> — sa validité n'est pas vérifiée, et bloquer son compte ne le coupe
        pas immédiatement. <strong>Sans réponse</strong> est le délai au bout duquel un appareil
        parti sans se déconnecter libère sa place, ce qui compte quand un profil n'autorise qu'un
        appareil.
      </p>

      {àGenerer && currentId && (
        <GenerationTickets
          routerId={currentId}
          cible="hotspot"
          profileName={àGenerer}
          onFermer={() => setÀGenerer(null)}
        />
      )}

      {erreurProfil && <ErrorNote>{erreurProfil}</ErrorNote>}

      {àModifier && (
        <EditionProfilHotspot
          profil={àModifier}
          enCours={modifier.isPending}
          onAnnuler={() => {
            setÀModifier(null);
            setErreurProfil(null);
          }}
          onValider={(dto) => modifier.mutate({ name: àModifier.name, dto })}
        />
      )}

      <ListeDuRouteur
        requête={requête}
        colonnes={[
          'Profil',
          'Descendant',
          'Montant',
          'Durée de session',
          'Appareils',
          'Inactivité',
          'Sans réponse',
          'Cookie',
          '',
        ]}
        vide={{ titre: 'Aucun profil HotSpot' }}
        ligne={(p) => (
          <tr key={p.id}>
            <td className="px-3 py-2 font-medium">{p.name}</td>
            <td className="px-3 py-2 tabular-nums">{formatDebit(p.rateLimitRxBitsPerSecond)}</td>
            <td className="px-3 py-2 tabular-nums">{formatDebit(p.rateLimitTxBitsPerSecond)}</td>
            <td className="px-3 py-2 tabular-nums">{formatDuree(p.sessionTimeoutSeconds)}</td>
            <td className="px-3 py-2 tabular-nums">{p.sharedUsers}</td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {formatDuree(p.idleTimeoutSeconds)}
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {formatDuree(p.keepaliveTimeoutSeconds)}
            </td>
            {/* Un cookie qui survit à la session vendue est un trou : le
                client revient sans repasser par User Manager, donc sans que
                sa validité soit vérifiée. Relevé sur ce parc — un ticket de
                deux heures portait un cookie de dix-huit. L'écart se voit
                maintenant au lieu de se deviner en comparant deux colonnes. */}
            <td className="px-3 py-2">
              {!p.addMacCookie ? (
                <Badge tone="slate">aucun</Badge>
              ) : (
                <>
                  <Badge
                    tone={
                      p.sessionTimeoutSeconds != null &&
                      p.macCookieTimeoutSeconds != null &&
                      p.macCookieTimeoutSeconds > p.sessionTimeoutSeconds
                        ? 'red'
                        : 'amber'
                    }
                  >
                    {formatDuree(p.macCookieTimeoutSeconds)}
                  </Badge>
                  {p.sessionTimeoutSeconds != null &&
                    p.macCookieTimeoutSeconds != null &&
                    p.macCookieTimeoutSeconds > p.sessionTimeoutSeconds && (
                      <div className="text-xs text-red-700">plus long que la session</div>
                    )}
                </>
              )}
            </td>
            <td className="space-x-2 whitespace-nowrap px-3 py-2 text-right">
              {canWrite && (
                <>
                  <Button onClick={() => setÀGenerer(p.name)}>Générer</Button>
                  <Button variant="secondary" onClick={() => setÀModifier(p)}>
                    Modifier
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
      <ListeDuRouteur
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
      <ListeDuRouteur
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
      <ListeDuRouteur
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
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const requête = useQuery({
    queryKey: ['um-assignments', currentId],
    queryFn: () => umTabsApi.assignments(currentId),
  });
  // Les deux listes qui alimentent le formulaire : on choisit un compte
  // existant et un profil existant, comme dans WinBox — taper un nom libre
  // ne produirait qu'une erreur du routeur.
  const comptes = useQuery({
    queryKey: ['um-accounts', currentId],
    queryFn: () => userManagerApi.listAccounts(currentId),
  });
  const profils = useQuery({
    queryKey: ['um-profiles', currentId],
    queryFn: () => userManagerApi.listProfiles(currentId),
  });

  const [compte, setCompte] = useState('');
  const [profil, setProfil] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const rafraichir = () =>
    queryClient.invalidateQueries({ queryKey: ['um-assignments', currentId] });

  const attribuer = useMutation({
    mutationFn: () => umTabsApi.attribuer(compte, profil, currentId),
    onSuccess: () => {
      setErreur(null);
      setCompte('');
      setProfil('');
      rafraichir();
    },
    onError: (e: unknown) => setErreur(e instanceof ApiError ? e.message : 'Erreur inconnue'),
  });

  const retirer = useMutation({
    mutationFn: ({ username, profileName }: { username: string; profileName: string }) =>
      umTabsApi.retirer(username, profileName, currentId),
    onSuccess: () => {
      setErreur(null);
      rafraichir();
    },
    onError: (e: unknown) => setErreur(e instanceof ApiError ? e.message : 'Erreur inconnue'),
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
      {(requête.data ?? []).some((a) => a.usernameIntrouvable) && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Certaines attributions désignent un <strong>compte qui n'existe plus</strong> : User
          Manager ne les efface pas quand le compte part. Elles ne servent plus personne, mais
          elles continuaient d'être comptées comme des comptes sur l'écran Profils.
        </p>
      )}
      {erreur && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {erreur}
        </p>
      )}

      {/* Le « User Profile > New » de WinBox. La route existait côté serveur
          et aucun écran ne l'appelait : attribuer un profil supposait donc
          d'ouvrir WinBox. */}
      {canWrite && (
        <Card title="Attribuer un profil à un compte">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <FormField label="Compte">
              <Select value={compte} onChange={(e) => setCompte(e.target.value)}>
                <option value="">Choisir…</option>
                {(comptes.data ?? []).map((c) => (
                  <option key={c.username} value={c.username}>
                    {c.username}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Profil">
              <Select value={profil} onChange={(e) => setProfil(e.target.value)}>
                <option value="">Choisir…</option>
                {(profils.data ?? []).map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={!compte || !profil || attribuer.isPending}
                onClick={() => attribuer.mutate()}
              >
                {attribuer.isPending ? 'Attribution…' : 'Attribuer'}
              </Button>
            </div>
          </div>
          <p className="mt-3 max-w-3xl text-xs text-slate-500">
            L&apos;échéance dépend du profil : « à l&apos;attribution » lance le compte à
            rebours tout de suite, « à la 1re connexion » attend que le client se connecte.
            Un compte peut porter plusieurs attributions — un rachat en ajoute une.
          </p>
        </Card>
      )}

      <ListeDuRouteur
        requête={requête}
        colonnes={canWrite ? ['Compte', 'Profil', 'Expire le', 'État', ''] : ['Compte', 'Profil', 'Expire le', 'État']}
        vide={{
          titre: 'Aucune attribution',
          aide: 'Un compte reçoit son attribution à la première authentification.',
        }}
        ligne={(a) => (
          <tr key={a.id}>
            {/* Un identifiant RouterOS là où un nom est attendu veut dire que
                le compte a disparu et que l'attribution lui a survécu. L'écrire
                tel quel le faisait passer pour un nom de compte. */}
            <td className="px-3 py-2 font-mono text-xs">
              {a.usernameIntrouvable ? (
                <span className="text-slate-400">référence {a.username}</span>
              ) : (
                a.username
              )}
            </td>
            <td className="px-3 py-2">{a.profileName}</td>
            <td className="px-3 py-2 text-slate-500">{a.endTime ?? '—'}</td>
            <td className="px-3 py-2">
              {a.usernameIntrouvable ? (
                <Badge tone="red">compte disparu</Badge>
              ) : (
                <Badge tone={TON[a.state] ?? 'slate'}>{a.state}</Badge>
              )}
            </td>
            {canWrite && (
              <td className="px-3 py-2 text-right">
                {/* Rien à retirer pour une attribution dont le compte a
                    disparu : le routeur la cherche par nom de compte, et ce
                    nom n'existe plus. Proposer le bouton promettrait un geste
                    qui échouerait. */}
                {!a.usernameIntrouvable && (
                  <Button
                    variant="secondary"
                    disabled={retirer.isPending}
                    onClick={() =>
                      retirer.mutate({ username: a.username, profileName: a.profileName })
                    }
                  >
                    Retirer
                  </Button>
                )}
              </td>
            )}
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
      <ListeDuRouteur
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
      <ListeDuRouteur
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
      <ListeDuRouteur
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
      <ListeDuRouteur
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
        <Compteur requête={requête} nombre={filtrés.length} unité="attribut(s)" />
      </div>
      <Input
        value={terme}
        onChange={(e) => setTerme(e.target.value)}
        placeholder="Filtrer par nom"
        className="max-w-sm"
      />
      <ListeDuRouteur
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
