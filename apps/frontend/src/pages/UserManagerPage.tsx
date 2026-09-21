import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatBytes,
  formatDuration,
  formatRate,
  userManagerApi,
  type AccountSource,
  type CreateAccountInput,
  type CreateLimitationInput,
  type CreateProfileInput,
  type UpdateLimitationInput,
  type UpdateProfileInput,
  type UserManagerLimitation,
  type UserManagerProfile,
} from '../api/user-manager';
import { ProfileLimitationsTab } from './ProfileLimitationsTab';
import { useAuth } from '../auth/AuthContext';
import { ETAT_COMPTE_UM, libellé } from '../api/libelles';
import { FormulaireLimitation } from '../components/FormulaireLimitation';
import { Modale } from '../components/Modale';
import { BarreSelection, CaseLigne, useSelection } from '../components/Selection';
import { phraseCoupure } from '../api/coupure';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { useRouterSelection } from '../routers/RouterContext';
import { GenerationTickets } from '../components/GenerationTickets';
import {
  ChampDuree,
  Confirmation,
  EditionDuree,
  EditionUnChamp,
} from '../components/Edition';
import { useCurrency } from '../api/money';
import { ApiError } from '../api/client';
import {
  Badge,
  Button,
  Compteur,
  EmptyRow,
  FormField,
  Input,
  PageHeader,
  Select,
  Table,
} from '../components/ui';
import {
  UmAssignmentsTab,
  UmAttributesTab,
  UmPaymentsTab,
  UmRoutersTab,
  UmSessionsTab,
  UmUserGroupsTab,
} from './RouterTabs';
import { TabBar, type TabDef } from '../components/TabBar';

/** Un onglet par table de User Manager, dans l'ordre de WinBox. */
const ONGLETS = {
  routeurs: { titre: 'Routeurs RADIUS', rendu: () => <UmRoutersTab /> },
  comptes: { titre: 'Comptes', rendu: () => <AccountsTab /> },
  groupes: { titre: "Groupes d'authentification", rendu: () => <UmUserGroupsTab /> },
  sessions: { titre: 'Sessions', rendu: () => <UmSessionsTab /> },
  profils: { titre: 'Profils', rendu: () => <ProfilesTab /> },
  attributions: { titre: 'Attributions', rendu: () => <UmAssignmentsTab /> },
  limitations: { titre: 'Limitations', rendu: () => <LimitationsTab /> },
  'limitations-profil': {
    titre: 'Limitations par forfait',
    rendu: () => <ProfileLimitationsTab />,
  },
  attributs: { titre: 'Attributs RADIUS', rendu: () => <UmAttributesTab /> },
  paiements: { titre: 'Paiements du routeur', rendu: () => <UmPaymentsTab /> },
} as const;

type Tab = keyof typeof ONGLETS;

const BARRE: TabDef[] = Object.entries(ONGLETS).map(([to, { titre }]) => ({ to, label: titre }));

const SOURCE_LABEL: Record<AccountSource, { label: string; tone: 'green' | 'amber' | 'slate' }> = {
  ABONNEMENT: { label: 'Abonnement', tone: 'green' },
  TICKET: { label: 'Ticket', tone: 'amber' },
  HORS_APPLICATION: { label: 'Hors application', tone: 'slate' },
};

/**
 * L'onglet vient de l'adresse : chaque table est atteignable par son lien,
 * et le retour arrière du navigateur fait ce qu'on attend.
 */
export function UserManagerPage() {
  const { tab } = useParams();
  const courant: Tab = tab && tab in ONGLETS ? (tab as Tab) : 'comptes';

  return (
    <div className="space-y-5">
      <PageHeader
        title="User Manager"
        description="Ce que porte réellement le routeur. La validité y est calendaire : elle continue de s'appliquer, même cette console fermée."
      />
      <TabBar base="/user-manager" tabs={BARRE} />
      {ONGLETS[courant].rendu()}
    </div>
  );
}

/** Message d'erreur d'une action, au même endroit pour tous les onglets. */
function useActionError() {
  const [error, setError] = useState<string | null>(null);
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
  return { error, setError, onError };
}

function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
      {children}
    </div>
  );
}

// ==================== Profils ====================

const EMPTY_PROFILE: CreateProfileInput = {
  name: '',
  validityDurationSeconds: 86_400,
  startsWhen: 'first-auth',
};

function ProfilesTab() {
  const { canWrite } = useAuth();
  const { format } = useCurrency();
  const queryClient = useQueryClient();
  const { error, setError, onError } = useActionError();
  const [form, setForm] = useState<CreateProfileInput>(EMPTY_PROFILE);
  /** Le profil pour lequel on génère, quand le panneau est ouvert. */
  const [àGenerer, setÀGenerer] = useState<string | null>(null);
  const [àModifier, setÀModifier] = useState<UserManagerProfile | null>(null);
  const [créer, setCréer] = useState(false);
  /** Le profil qu'on s'apprête à supprimer, tant que ce n'est pas confirmé. */
  const [àSupprimer, setÀSupprimer] = useState<string | null>(null);

  const { currentId } = useRouterSelection();
  const profiles = useQuery({
    queryKey: ['um-profiles', currentId],
    queryFn: () => userManagerApi.listProfiles(currentId),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['um-profiles'] });

  const create = useMutation({
    mutationFn: (input: CreateProfileInput) => userManagerApi.createProfile(input, currentId),
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_PROFILE);
      setCréer(false);
      refresh();
    },
    onError,
  });
  /**
   * Modifier la validité d'un profil.
   *
   * Sans effet sur les comptes déjà attribués : RouterOS fige l'échéance au
   * moment de l'attribution. L'annoncer dans la question évite de croire
   * qu'on vient de prolonger des tickets déjà vendus.
   */
  const modifier = useMutation({
    mutationFn: ({ name, input }: { name: string; input: UpdateProfileInput }) =>
      userManagerApi.updateProfile(name, input, currentId),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['um-profiles'] });
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: (name: string) => userManagerApi.deleteProfile(name, currentId),
    onSuccess: () => {
      setError(null);
      setÀSupprimer(null);
      refresh();
    },
    onError,
  });

  function handleSubmit() {
    if (!form.name.trim()) {
      setError("Indiquez le nom du profil");
      return;
    }
    create.mutate(form);
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {àGenerer && currentId && (
        <GenerationTickets
          routerId={currentId}
          cible="user-manager"
          profileName={àGenerer}
          onFermer={() => setÀGenerer(null)}
        />
      )}

      {àSupprimer && (
        <Confirmation
          titre={`Supprimer le profil « ${àSupprimer} » ?`}
          libelléConfirmer="Supprimer le profil"
          enCours={remove.isPending}
          erreur={remove.isError ? error : null}
          onAnnuler={() => {
            setError(null);
            setÀSupprimer(null);
          }}
          onConfirmer={() => remove.mutate(àSupprimer)}
        >
          Aucun compte ne s&apos;en sert aujourd&apos;hui, sans quoi le bouton ne serait pas
          là. Une offre de l&apos;application qui le désigne par son nom{' '}
          <strong>resterait vendable et échouerait à chaque ticket</strong> : le routeur
          refuse un profil qu&apos;il ne connaît pas.
        </Confirmation>
      )}

      {àModifier && (
        <EditionDuree
          titre={`Validité du profil « ${àModifier.name} »`}
          description={
            <>
              Les comptes <strong>déjà attribués gardent la leur</strong> : RouterOS fige
              l'échéance au moment de l'attribution. Le changement ne vaut que pour les
              attributions suivantes — il ne prolonge aucun ticket déjà vendu.
            </>
          }
          libellé="Nouvelle validité"
          secondesInitiales={àModifier.validityDurationSeconds}
          enCours={modifier.isPending}
          onAnnuler={() => setÀModifier(null)}
          onValider={(secondes) => {
            modifier.mutate({
              name: àModifier.name,
              input: { validityDurationSeconds: secondes },
            });
            setÀModifier(null);
          }}
        />
      )}

      {canWrite && (
        <div>
          <Button onClick={() => setCréer(true)}>Nouveau profil</Button>
        </div>
      )}

      {canWrite && créer && (
        <Modale
          large
          titre="Nouveau profil"
          onFermer={() => setCréer(false)}
          actions={
            <Button disabled={create.isPending} onClick={() => handleSubmit()}>
              {create.isPending ? 'Création…' : 'Créer'}
            </Button>
          }
          note={
            <>
              Un profil créé ici vit uniquement sur le routeur. Pour une offre vendue dans
              l&apos;application, passez par l&apos;écran Offres : elle y est tenue
              synchronisée.
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <FormField label="Nom">
              <Input
                value={form.name}
                placeholder="1Jour-2000Ar"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </FormField>
            <FormField label="Validité">
              {/* Le parc va de 15 min à 30 j : imposer les heures ferait
                  saisir « 0.25 » pour un ticket court et « 720 » pour un
                  forfait mensuel. */}
              <ChampDuree
                secondes={form.validityDurationSeconds}
                onChange={(secondes) =>
                  setForm({ ...form, validityDurationSeconds: secondes })
                }
              />
            </FormField>
            <FormField label="La validité démarre">
              <Select
                value={form.startsWhen}
                onChange={(e) =>
                  setForm({ ...form, startsWhen: e.target.value as CreateProfileInput['startsWhen'] })
                }
              >
                <option value="first-auth">à la 1re connexion</option>
                <option value="assigned">à l'attribution</option>
              </Select>
            </FormField>
            <FormField label="Prix">
              <Input
                type="number"
                min={0}
                value={form.price ?? ''}
                onChange={(e) =>
                  setForm({ ...form, price: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </FormField>
            {/* Les trois champs que WinBox propose et qui manquaient ici. Le
                routeur les acceptait déjà : seul le formulaire les ignorait,
                si bien qu'un profil créé depuis la console ne pouvait ni
                porter de nom public, ni de commentaire, ni relever le nombre
                d'appareils simultanés. */}
            <FormField label="Nom vu par le client">
              <Input
                value={form.nameForUsers ?? ''}
                placeholder={form.name || 'le nom du profil'}
                onChange={(e) =>
                  setForm({ ...form, nameForUsers: e.target.value || undefined })
                }
              />
            </FormField>
            <FormField label="Appareils simultanés">
              <Input
                type="number"
                min={1}
                max={50}
                value={form.sharedUsers ?? ''}
                placeholder="1"
                onChange={(e) =>
                  setForm({
                    ...form,
                    sharedUsers: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </FormField>
            <FormField label="Commentaire">
              <Input
                value={form.comment ?? ''}
                onChange={(e) => setForm({ ...form, comment: e.target.value || undefined })}
              />
            </FormField>
            <button type="submit" className="hidden" aria-hidden />
          </form>
        </Modale>
      )}

      {/* Une table vide et une table en échec se confondaient à l'œil : sans
          réponse, `data` reste vide et la ligne « aucun profil » ne s'affiche
          pas non plus, sa garde comparant `undefined` à zéro. Sur cet écran-là,
          conclure « les profils ont disparu » envoie restaurer une sauvegarde
          pour une panne de lien. */}
      {profiles.isLoading ? (
        <p className="text-slate-500">Chargement…</p>
      ) : profiles.isError ? (
        <PanneDuRouteur requête={profiles} />
      ) : (
        <Table head={['Profil', 'Validité', 'Démarre', 'Prix', 'Appareils', 'Limitations', 'Comptes', 'Offre', '']}>
          {profiles.data?.map((profile) => (
            <tr key={profile.id}>
              <td className="px-3 py-2 font-medium">{profile.name}</td>
              <td className="px-3 py-2">{formatDuration(profile.validityDurationSeconds)}</td>
              <td className="px-3 py-2 text-slate-500">
                {profile.startsWhen === 'first-auth' ? '1re connexion' : 'attribution'}
              </td>
              <td className="px-3 py-2">{profile.price ? format(profile.price) : '—'}</td>
              <td className="px-3 py-2 text-slate-500">{profile.overrideSharedUsers ?? 1}</td>
              <td className="px-3 py-2 text-slate-500">
                {profile.limitationNames.length ? profile.limitationNames.join(', ') : '—'}
              </td>
              <td className="px-3 py-2">
                {profile.accountCount}
                {profile.attributionsOrphelines > 0 && (
                  <span className="ml-1.5 text-xs text-amber-700">
                    + {profile.attributionsOrphelines} disparu(s)
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                {profile.planName ? (
                  <Badge tone="green">{profile.planName}</Badge>
                ) : (
                  <Badge tone="slate">hors offre</Badge>
                )}
              </td>
              <td className="px-3 py-2">
                {canWrite && (
                  <div className="flex justify-end gap-1">
                    <Button onClick={() => setÀGenerer(profile.name)}>Générer</Button>
                    <Button variant="secondary" onClick={() => setÀModifier(profile)}>
                      Modifier
                    </Button>
                    {/* Supprimer reste interdit tant qu'une attribution s'y
                        rattache : RouterOS refuserait, et l'échec serait
                        moins clair que l'absence du bouton.
                        **Les orphelines comptent aussi.** Les exclure du
                        décompte des comptes — ce qu'elles méritent, elles ne
                        désignent personne — faisait apparaître le bouton sur des
                        profils encore référencés seize fois. */}
                    {profile.accountCount === 0 && profile.attributionsOrphelines === 0 && (
                      <Button variant="danger" onClick={() => setÀSupprimer(profile.name)}>
                        Supprimer
                      </Button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
          {profiles.data?.length === 0 && (
            <EmptyRow colSpan={9}>Aucun profil sur ce routeur.</EmptyRow>
          )}
        </Table>
      )}
    </div>
  );
}

// ==================== Limitations ====================

function LimitationsTab() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const { error, setError, onError } = useActionError();
  const [àModifier, setÀModifier] = useState<UserManagerLimitation | null>(null);
  const [nonceFormulaire, setNonceFormulaire] = useState(0);
  // Derrière un bouton, comme le « New » de WinBox. Le formulaire était
  // déplié en permanence ; avec les neuf champs de réglage fin, il occuperait
  // l'écran avant qu'on ait vu la liste.
  const [créer, setCréer] = useState(false);
  /** La limitation qu'on s'apprête à supprimer, tant que ce n'est pas confirmé. */
  const [àSupprimerLim, setÀSupprimerLim] = useState<string | null>(null);

  const { currentId } = useRouterSelection();
  const limitations = useQuery({
    queryKey: ['um-limitations', currentId],
    queryFn: () => userManagerApi.listLimitations(currentId),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['um-limitations'] });
    queryClient.invalidateQueries({ queryKey: ['um-profiles'] });
  };

  const create = useMutation({
    mutationFn: (input: CreateLimitationInput) =>
      userManagerApi.createLimitation(input, currentId),
    onSuccess: () => {
      setError(null);
      // Le formulaire porte désormais son propre état : on le remonte plutôt
      // que de le vider de l'extérieur, ce qui demanderait de dupliquer ici la
      // liste de ses champs — et de l'oublier au prochain champ ajouté.
      setNonceFormulaire((n) => n + 1);
      setCréer(false);
      refresh();
    },
    onError,
  });
  /**
   * Modifier le débit d'une limitation.
   *
   * Contrairement à la validité d'un profil, ceci **s'applique tout de
   * suite** : la limitation est lue à chaque session. Changer le débit
   * change ce que reçoivent les abonnés déjà connectés dès leur prochaine
   * connexion — dit dans la question, pour qu'on le sache avant de valider.
   */
  const modifier = useMutation({
    mutationFn: ({ name, input }: { name: string; input: UpdateLimitationInput }) =>
      userManagerApi.updateLimitation(name, input, currentId),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: (name: string) => userManagerApi.deleteLimitation(name, currentId),
    onSuccess: () => {
      setError(null);
      setÀSupprimerLim(null);
      refresh();
    },
    onError,
  });

  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {àSupprimerLim && (
        <Confirmation
          titre={`Supprimer la limitation « ${àSupprimerLim} » ?`}
          libelléConfirmer="Supprimer la limitation"
          enCours={remove.isPending}
          erreur={remove.isError ? error : null}
          onAnnuler={() => {
            setError(null);
            setÀSupprimerLim(null);
          }}
          onConfirmer={() => remove.mutate(àSupprimerLim)}
        >
          Aucun forfait ne s&apos;y rattache aujourd&apos;hui, sans quoi le routeur refuserait
          et le bouton ne serait pas là. Ses réglages de débit, de volume et de pointe partent
          avec : les retrouver supposerait de les ressaisir un à un.
        </Confirmation>
      )}

      {àModifier && (
        <FormulaireLimitation
          limitation={àModifier}
          enCours={modifier.isPending}
          onAnnuler={() => setÀModifier(null)}
          onValider={(valeurs) => {
            const { name, ...reste } = valeurs;
            modifier.mutate({ name, input: reste });
            setÀModifier(null);
          }}
        />
      )}

      {/* Le bouton reste visible pendant qu'une fenêtre est ouverte : c'est
          elle qui couvre la liste, plus le formulaire qui la pousse. */}
      {canWrite && (
        <div>
          <Button onClick={() => setCréer(true)}>Nouvelle limitation</Button>
        </div>
      )}

      {canWrite && créer && (
        <FormulaireLimitation
          key={nonceFormulaire}
          enCours={create.isPending}
          onAnnuler={() => setCréer(false)}
          onValider={(valeurs) => {
            if (!valeurs.name.trim()) {
              setError('Indiquez le nom de la limitation');
              return;
            }
            create.mutate(valeurs);
          }}
        />
      )}

      {limitations.isLoading ? (
        <p className="text-slate-500">Chargement…</p>
      ) : limitations.isError ? (
        <PanneDuRouteur requête={limitations} />
      ) : (
        <Table
          head={[
            'Limitation',
            'Descendant',
            'Montant',
            'Volume total',
            'Dont reçu / envoyé',
            'Durée',
            'Remise à zéro',
            'Profils',
            '',
          ]}
        >
          {limitations.data?.map((limitation) => (
            <tr key={limitation.id}>
              <td className="px-3 py-2 font-medium">{limitation.name}</td>
              <td className="px-3 py-2">{formatRate(limitation.rateLimit.rxBitsPerSecond)}</td>
              <td className="px-3 py-2">{formatRate(limitation.rateLimit.txBitsPerSecond)}</td>
              <td className="px-3 py-2">{formatBytes(limitation.transferLimitBytes)}</td>
              {/* Distincts du total : un forfait peut laisser télécharger
                  largement et brider l'envoi. */}
              <td className="px-3 py-2 text-slate-500">
                {limitation.downloadLimitBytes || limitation.uploadLimitBytes
                  ? `${formatBytes(limitation.downloadLimitBytes)} / ${formatBytes(limitation.uploadLimitBytes)}`
                  : '—'}
              </td>
              <td className="px-3 py-2">{formatDuration(limitation.uptimeLimitSeconds)}</td>
              {/* La différence entre « 10 Go » et « 10 Go par mois ». Sans
                  période, le quota est consommé une fois pour toutes. */}
              <td className="px-3 py-2 text-slate-500">
                {limitation.resetCountersIntervalSeconds ? (
                  <>
                    {formatDuration(limitation.resetCountersIntervalSeconds)}
                    {limitation.resetCountersStartTime && (
                      <div className="text-xs text-slate-400">
                        depuis le {limitation.resetCountersStartTime.slice(0, 10)}
                      </div>
                    )}
                  </>
                ) : (
                  <span title="Le quota est consommé une fois pour toutes">définitif</span>
                )}
              </td>
              <td className="px-3 py-2 text-slate-500">
                {limitation.profileNames.length ? limitation.profileNames.join(', ') : '—'}
              </td>
              <td className="px-3 py-2">
                {canWrite && (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="secondary"
                      onClick={() => setÀModifier(limitation)}
                    >
                      Modifier
                    </Button>
                    {/* RouterOS refuse de supprimer une limitation rattachée
                        à un profil : mieux vaut pas de bouton qu'un échec. */}
                    {limitation.profileNames.length === 0 && (
                      <Button
                        variant="danger"
                        onClick={() => setÀSupprimerLim(limitation.name)}
                      >
                        Supprimer
                      </Button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
          {limitations.data?.length === 0 && (
            <EmptyRow
              colSpan={7}
              hint="Les plafonds d'une offre en créent une automatiquement."
            >
              Aucune limitation
            </EmptyRow>
          )}
        </Table>
      )}
    </div>
  );
}

// ==================== Comptes ====================

const EMPTY_ACCOUNT: CreateAccountInput = { username: '', password: '' };

function AccountsTab() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const { error, setError, onError } = useActionError();
  const [form, setForm] = useState<CreateAccountInput>(EMPTY_ACCOUNT);
  const [sourceFilter, setSourceFilter] = useState<AccountSource | ''>('');
  /**
   * Le geste demandé sur une ligne, tant qu'il n'est pas confirmé.
   *
   * Les boutons restent sur la ligne — c'est là qu'on les cherche — mais
   * aucun n'écrit sur le routeur au clic : chacun pose une question, et
   * c'est la réponse qui écrit.
   */
  const [àConfirmer, setÀConfirmer] = useState<{
    geste: 'suspendre' | 'reactiver' | 'supprimer';
    compte: string;
  } | null>(null);
  /** Le compte dont on change le code : le seul geste qui demande une saisie. */
  const [àRecoder, setÀRecoder] = useState<string | null>(null);
  const [créer, setCréer] = useState(false);

  const { currentId } = useRouterSelection();
  const accounts = useQuery({
    queryKey: ['um-accounts', currentId],
    queryFn: () => userManagerApi.listAccounts(currentId),
  });
  const profiles = useQuery({
    queryKey: ['um-profiles', currentId],
    queryFn: () => userManagerApi.listProfiles(currentId),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['um-accounts'] });

  const create = useMutation({
    mutationFn: (input: CreateAccountInput) => userManagerApi.createAccount(input, currentId),
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_ACCOUNT);
      setCréer(false);
      refresh();
    },
    onError,
  });
  /**
   * Suspendre coupe pour de bon, et le dit.
   *
   * Désactiver le compte ne fermait pas la session en cours, et le
   * `mac-cookie` du client valait encore trois jours : la suspension
   * manuelle était **plus faible** que celle du travail planifié. Le compte
   * rendu permet de vérifier que le client est hors ligne au lieu de le
   * supposer.
   */
  const [coupure, setCoupure] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: ({ username, disabled }: { username: string; disabled: boolean }) =>
      userManagerApi.setAccountDisabled(username, disabled, currentId),
    onSuccess: (compte) => {
      setError(null);
      setCoupure(phraseCoupure(compte.coupure));
      setÀConfirmer(null);
      refresh();
    },
    onError,
  });

  /**
   * Rotation du mot de passe.
   *
   * Le compte garde son nom, ses attributions et son historique — c'est
   * justement l'intérêt : un code lu à voix haute au comptoir se change sans
   * refaire le ticket ni perdre la validité déjà courue.
   */
  const changerCode = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      userManagerApi.updateAccount(username, { password }, currentId),
    onSuccess: () => {
      setError(null);
      setÀRecoder(null);
      refresh();
    },
    onError,
  });

  const supprimer = useMutation({
    mutationFn: (username: string) => userManagerApi.deleteAccount(username, currentId),
    // La fenêtre se referme ici, et non au clic : fermer avant de connaître
    // la réponse du routeur faisait lire « c'est fait » sur un refus.
    onSuccess: () => {
      setError(null);
      setÀConfirmer(null);
      refresh();
    },
    onError,
  });

  function handleSubmit() {
    if (!form.username.trim() || !form.password) {
      setError('Le nom du compte et le mot de passe sont requis');
      return;
    }
    create.mutate(form);
  }

  const visible = accounts.data?.filter((a) => !sourceFilter || a.source === sourceFilter);

  // ==================== Agir sur un lot ====================

  const lignes = visible ?? [];
  const selection = useSelection(lignes.map((a) => a.username));
  const choisis = lignes.filter((a) => selection.estChoisie(a.username));
  /** Le geste demandé sur le lot, tant qu'il n'est pas confirmé. */
  const [enLot, setEnLot] = useState<'suspendre' | 'reactiver' | 'supprimer' | null>(null);

  /**
   * Un compte à la fois, et on continue après un échec.
   *
   * RouterOS n'a pas d'écriture en lot : ce sont N appels. S'arrêter au
   * premier refus laisserait la moitié du lot traité sans qu'on sache
   * laquelle — on va donc au bout et on rend le compte rendu.
   */
  const lot = useMutation({
    mutationFn: async (geste: 'suspendre' | 'reactiver' | 'supprimer') => {
      const échecs: string[] = [];
      for (const compte of choisis) {
        try {
          if (geste === 'supprimer') {
            await userManagerApi.deleteAccount(compte.username, currentId);
          } else {
            await userManagerApi.setAccountDisabled(
              compte.username,
              geste === 'suspendre',
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
      setError(
        échecs.length === 0
          ? null
          : `${échecs.length} compte(s) n’ont pas abouti : ${échecs.slice(0, 8).join(', ')}${échecs.length > 8 ? '…' : ''}`,
      );
      setEnLot(null);
      selection.vider();
      refresh();
    },
    onError,
  });

  /** Ce que chaque geste écrit, dit avant de le faire. */
  const LIBELLÉ_LOT = {
    suspendre: { verbe: 'Suspendre', bouton: 'Suspendre' },
    reactiver: { verbe: 'Réactiver', bouton: 'Réactiver' },
    supprimer: { verbe: 'Supprimer', bouton: 'Supprimer quand même' },
  } as const;

  // Les sélections groupées. Chacune dit son nombre avant qu'on clique.
  const parProfil = [...new Set(lignes.map((a) => a.profileName).filter(Boolean))].map(
    (nom) => ({
      libellé: nom as string,
      clés: lignes.filter((a) => a.profileName === nom).map((a) => a.username),
    }),
  );
  const parEtat = [
    {
      libellé: 'expirés ou consommés',
      clés: lignes.filter((a) => a.state === 'used').map((a) => a.username),
    },
    {
      libellé: 'pas encore commencés',
      clés: lignes.filter((a) => a.state === 'waiting').map((a) => a.username),
    },
    {
      libellé: 'en cours',
      clés: lignes.filter((a) => a.state === 'running-active').map((a) => a.username),
    },
    {
      libellé: 'suspendus',
      clés: lignes.filter((a) => a.disabled).map((a) => a.username),
    },
    {
      libellé: 'sans profil',
      clés: lignes.filter((a) => !a.profileName).map((a) => a.username),
    },
  ];

  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {coupure && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {coupure}
        </p>
      )}

      {àConfirmer && (
        <Confirmation
          titre={
            àConfirmer.geste === 'supprimer'
              ? `Voulez-vous vraiment supprimer « ${àConfirmer.compte} » ?`
              : àConfirmer.geste === 'suspendre'
                ? `Voulez-vous vraiment suspendre « ${àConfirmer.compte} » ?`
                : `Voulez-vous vraiment réactiver « ${àConfirmer.compte} » ?`
          }
          enCours={supprimer.isPending || toggle.isPending}
          erreur={supprimer.isError || toggle.isError ? error : null}
          onAnnuler={() => {
            setError(null);
            setÀConfirmer(null);
          }}
          onConfirmer={() => {
            setError(null);
            if (àConfirmer.geste === 'supprimer') supprimer.mutate(àConfirmer.compte);
            else
              toggle.mutate({
                username: àConfirmer.compte,
                disabled: àConfirmer.geste === 'suspendre',
              });
          }}
        >
          {/* La question dit ce qu'on perd, pas seulement ce qu'on fait :
              « êtes-vous sûr » n'apprend rien, la conséquence si. */}
          {àConfirmer.geste === 'supprimer' ? (
            <>
              Son historique de sessions part avec, et rien ne le rendra. Pour couper
              l&apos;accès sans rien perdre, <strong>Suspendre</strong> suffit — le compte
              reste, il ne répond plus.
            </>
          ) : àConfirmer.geste === 'suspendre' ? (
            <>
              Le compte reste et garde tout ; il cesse de répondre. La session d&apos;un client
              déjà connecté ne se ferme pas d&apos;elle-même.
            </>
          ) : (
            <>
              Le compte répondra de nouveau, avec la validité qu&apos;il lui restait — la
              suspension ne l&apos;a pas arrêtée.
            </>
          )}
        </Confirmation>
      )}

      {àRecoder && (
        <EditionUnChamp
          titre={`Nouveau code pour « ${àRecoder} »`}
          description={
            <>
              Le compte garde son nom, ses attributions et sa validité déjà courue : seul le
              code à saisir change. C&apos;est ce qu&apos;il faut quand un ticket a été lu à
              voix haute ou recopié par quelqu&apos;un d&apos;autre.
            </>
          }
          libellé="Nouveau code"
          placeholder="celui que le client saisira"
          enCours={changerCode.isPending}
          onAnnuler={() => setÀRecoder(null)}
          onValider={(code) => {
            if (!code.trim()) return 'Indiquez le nouveau code.';
            changerCode.mutate({ username: àRecoder, password: code.trim() });
          }}
        />
      )}

      {canWrite && (
        <div>
          <Button onClick={() => setCréer(true)}>Nouveau compte</Button>
        </div>
      )}

      {canWrite && créer && (
        <Modale
          titre="Nouveau compte"
          onFermer={() => setCréer(false)}
          actions={
            <Button disabled={create.isPending} onClick={() => handleSubmit()}>
              {create.isPending ? 'Création…' : 'Créer'}
            </Button>
          }
          note={
            <>
              Un compte sans profil existe mais n&apos;ouvre rien : c&apos;est le profil qui
              porte la validité et le débit. Le mot de passe est celui que le client saisira —
              le routeur ne le redonnera plus en clair une fois enregistré.
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <FormField label="Nom du compte">
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </FormField>
            <FormField label="Mot de passe">
              <Input
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </FormField>
            <FormField label="Profil">
              <Select
                value={form.profileName ?? ''}
                onChange={(e) =>
                  setForm({ ...form, profileName: e.target.value || undefined })
                }
              >
                <option value="">— aucun —</option>
                {profiles.data?.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Commentaire">
              <Input
                value={form.comment ?? ''}
                onChange={(e) => setForm({ ...form, comment: e.target.value || undefined })}
              />
            </FormField>
            <button type="submit" className="hidden" aria-hidden />
          </form>
        </Modale>
      )}

      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">Origine :</span>
        <Select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as AccountSource | '')}
          className="w-auto"
        >
          <option value="">Toutes</option>
          <option value="TICKET">Tickets</option>
          <option value="ABONNEMENT">Abonnements</option>
          <option value="HORS_APPLICATION">Hors application</option>
        </Select>
        {/* « 0 compte » était écrit même sans réponse du routeur : la longueur
            d'un tableau vide faute de lecture, sur un parc qui en compte 646. */}
        <Compteur
          requête={accounts}
          nombre={visible?.length ?? 0}
          unité={(visible?.length ?? 0) > 1 ? 'comptes' : 'compte'}
        />
      </div>

      {canWrite && !accounts.isLoading && !accounts.isError && lignes.length > 0 && (
        <BarreSelection
          nombre={selection.nombre}
          total={lignes.length}
          onTout={() => selection.poser(lignes.map((a) => a.username))}
          onRien={selection.vider}
          onChoisir={selection.poser}
          groupes={[
            { titre: 'Par profil', entrées: parProfil },
            { titre: 'Par état', entrées: parEtat },
          ]}
          actions={
            <>
              <Button variant="secondary" onClick={() => setEnLot('suspendre')}>
                Suspendre{selection.nombre > 1 ? ` les ${selection.nombre}` : ''}
              </Button>
              <Button variant="secondary" onClick={() => setEnLot('reactiver')}>
                Réactiver{selection.nombre > 1 ? ` les ${selection.nombre}` : ''}
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
          titre={`${LIBELLÉ_LOT[enLot].verbe} ${selection.nombre} compte${selection.nombre > 1 ? 's' : ''} sur le routeur`}
          libelléConfirmer={
            selection.nombre > 1
              ? `${LIBELLÉ_LOT[enLot].bouton} les ${selection.nombre}`
              : LIBELLÉ_LOT[enLot].bouton
          }
          enCours={lot.isPending}
          erreur={lot.isError ? error : null}
          onAnnuler={() => {
            setError(null);
            setEnLot(null);
          }}
          onConfirmer={() => lot.mutate(enLot)}
        >
          {/* Le nombre, et la liste tant qu'elle tient : « 40 comptes » ne se
              vérifie pas, « H872973, H869384… » si. */}
          <p>
            {choisis
              .slice(0, 12)
              .map((a) => a.username)
              .join(', ')}
            {choisis.length > 12 && ` … et ${choisis.length - 12} autres`}
          </p>
          <p className="mt-2">
            {enLot === 'supprimer' ? (
              <>
                Leur historique de sessions part avec, et rien ne le rendra.{' '}
                <strong>Il n&apos;y a pas de retour en arrière.</strong> Pour couper
                l&apos;accès sans rien perdre, <strong>Suspendre</strong> suffit — les comptes
                restent, ils ne répondent plus.
              </>
            ) : enLot === 'suspendre' ? (
              <>
                Les comptes restent et gardent tout ; ils cessent simplement de répondre. La
                session en cours d&apos;un client déjà connecté ne se ferme pas d&apos;elle-même.
              </>
            ) : (
              <>
                Les comptes répondront de nouveau, avec la validité qu&apos;il leur restait —
                la suspension ne l&apos;a pas arrêtée.
              </>
            )}
          </p>
          {selection.nombre > 1 && (
            <p className="mt-2 text-slate-500">
              Le routeur ne sait pas écrire en lot : ce sont {selection.nombre} écritures qui
              partent l&apos;une après l&apos;autre. En cas de refus sur l&apos;une, les autres
              se font quand même et le compte rendu nomme celles qui ont échoué.
            </p>
          )}
        </Confirmation>
      )}

      {accounts.isLoading ? (
        <p className="text-slate-500">Chargement…</p>
      ) : accounts.isError ? (
        <PanneDuRouteur requête={accounts} />
      ) : (
        <Table
          head={[
            ...(canWrite ? [''] : []),
            'Compte',
            'Origine',
            'Client',
            'Profil',
            'Début',
            'Fin',
            'État',
            '',
          ]}
        >
          {visible?.map((account) => (
            <tr
              key={account.username}
              className={
                selection.estChoisie(account.username)
                  ? 'bg-sky-50'
                  : account.disabled
                    ? 'bg-red-50/50'
                    : undefined
              }
            >
              {canWrite && (
                <CaseLigne
                  cochée={selection.estChoisie(account.username)}
                  libellé={account.username}
                  onBasculer={(avecMaj) => selection.basculer(account.username, avecMaj)}
                />
              )}
              <td className="px-3 py-2 font-mono">{account.username}</td>
              <td className="px-3 py-2">
                <Badge tone={SOURCE_LABEL[account.source].tone}>
                  {SOURCE_LABEL[account.source].label}
                </Badge>
              </td>
              <td className="px-3 py-2">{account.customerName ?? '—'}</td>
              <td className="px-3 py-2">
                {account.profileName ?? '—'}
                {account.assignmentCount > 1 && (
                  <span className="ml-1.5 text-xs text-slate-400">
                    ({account.assignmentCount} attributions)
                  </span>
                )}
              </td>
              {/* Deux colonnes, et non une. Une seule ne pouvait pas ne pas
                  tromper : sur un ticket de deux heures, l'échéance tombe le
                  jour même, souvent l'heure suivante — elle se lit alors comme
                  une date de début. Les deux côte à côte lèvent l'ambiguïté et
                  montrent d'un coup d'œil la durée réellement accordée. */}
              <td className="px-3 py-2 text-slate-500">
                {account.startTime ? (
                  <>
                    {new Date(account.startTime).toLocaleString('fr-FR')}
                    {/* Une date mesurée et une date calculée n'ont pas la
                        même valeur : la seconde se décale si la validité du
                        forfait a changé depuis. Le point le dit sans occuper
                        une colonne de plus. */}
                    {!account.startTimeMeasured && (
                      <span
                        className="ml-1 text-slate-400"
                        title="Date déduite de l’échéance et de la durée du forfait : le routeur n’a plus la session."
                      >
                        ≈
                      </span>
                    )}
                  </>
                ) : account.state === 'waiting' ? (
                  <span className="text-slate-400">pas commencé</span>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-2 text-slate-500">
                {account.endTime ? new Date(account.endTime).toLocaleString('fr-FR') : '—'}
              </td>
              <td className="px-3 py-2">
                {/* Suspendu l'emporte sur tout le reste : c'est une décision
                    prise, là où les autres états ne font que constater. Le
                    dernier cas recopiait la valeur brute de RouterOS — on
                    lisait `waiting` dans une colonne « État ». */}
                {account.disabled ? (
                  <Badge tone="red">suspendu</Badge>
                ) : (
                  <Badge tone={libellé(ETAT_COMPTE_UM, account.state ?? 'unknown').ton}>
                    {libellé(ETAT_COMPTE_UM, account.state ?? 'unknown').label}
                  </Badge>
                )}
              </td>
              <td className="px-3 py-2">
                {/* Les boutons restent sur la ligne, là où on les cherche.
                    Aucun n'écrit au clic : chacun pose sa question, et c'est
                    la réponse qui écrit. */}
                {canWrite && (
                  <div className="flex justify-end gap-1">
                    <Button variant="secondary" onClick={() => setÀRecoder(account.username)}>
                      Changer le code
                    </Button>
                    <Button
                      variant={account.disabled ? 'secondary' : 'danger'}
                      onClick={() =>
                        setÀConfirmer({
                          geste: account.disabled ? 'reactiver' : 'suspendre',
                          compte: account.username,
                        })
                      }
                    >
                      {account.disabled ? 'Réactiver' : 'Suspendre'}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() =>
                        setÀConfirmer({ geste: 'supprimer', compte: account.username })
                      }
                    >
                      Supprimer
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {visible?.length === 0 && (
            <EmptyRow colSpan={canWrite ? 9 : 8}>Aucun compte pour ce filtre.</EmptyRow>
          )}
        </Table>
      )}

      {/* Dire d'où vient la colonne Début, parce qu'elle ne vient pas du
          routeur. Le taire donnerait à une valeur calculée le même poids
          qu'à une valeur lue, et l'écart possible ne se verrait jamais. */}
      {!accounts.isLoading && !accounts.isError && (
        <p className="max-w-3xl text-xs text-slate-500">
          Le routeur ne range <strong>aucune date de départ</strong> : il ne garde que
          l&apos;échéance. La colonne <strong>Début</strong> vient donc des sessions du compte
          quand le routeur les a encore — c&apos;est l&apos;heure réelle de la connexion. Sinon
          elle est calculée, échéance moins durée du forfait, et marquée{' '}
          <span className="text-slate-400">≈</span> : ce calcul se décale si la durée du
          forfait a été modifiée depuis l&apos;attribution, car le routeur fige
          l&apos;échéance mais pas la durée.
        </p>
      )}
    </div>
  );
}
