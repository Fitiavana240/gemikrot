import { useState, type FormEvent, type ReactNode } from 'react';
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
import { useAuth } from '../auth/AuthContext';
import { useRouterSelection } from '../routers/RouterContext';
import { GenerationTickets } from '../components/GenerationTickets';
import {
  ChampDuree,
  ConfirmationInline,
  EditionDuree,
  EditionUnChamp,
} from '../components/Edition';
import { useCurrency } from '../api/money';
import { ApiError } from '../api/client';
import {
  Badge,
  Button,
  Card,
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
      refresh();
    },
    onError,
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
        <Card title="Créer un profil">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-5">
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
            <div className="flex items-end">
              <Button type="submit" disabled={create.isPending} className="w-full">
                {create.isPending ? 'Création…' : 'Créer'}
              </Button>
            </div>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Un profil créé ici vit uniquement sur le routeur. Pour une offre vendue dans
            l'application, passez par l'écran Offres : elle y est tenue synchronisée.
          </p>
        </Card>
      )}

      {profiles.isLoading ? (
        <p className="text-slate-500">Chargement…</p>
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
              <td className="px-3 py-2">{profile.accountCount}</td>
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
                    {/* Supprimer reste interdit tant qu'un compte s'y
                        rattache : RouterOS refuserait, et l'échec serait
                        moins clair que l'absence du bouton. */}
                    {profile.accountCount === 0 && (
                      <Button variant="danger" onClick={() => remove.mutate(profile.name)}>
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

const EMPTY_LIMITATION: CreateLimitationInput = { name: '' };

function LimitationsTab() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const { error, setError, onError } = useActionError();
  const [form, setForm] = useState<CreateLimitationInput>(EMPTY_LIMITATION);
  const [àModifier, setÀModifier] = useState<UserManagerLimitation | null>(null);

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
      setForm(EMPTY_LIMITATION);
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
      refresh();
    },
    onError,
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Indiquez le nom de la limitation');
      return;
    }
    create.mutate(form);
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {àModifier && (
        <EditionUnChamp
          titre={`Débit descendant de « ${àModifier.name} »`}
          description={
            <>
              Contrairement à la validité d'un profil, ceci <strong>s'applique à tous</strong> les
              abonnés qui utilisent cette limitation, dès leur prochaine connexion — y compris
              ceux dont le ticket est déjà vendu.
            </>
          }
          libellé="Nouveau débit descendant"
          unité="Mb/s"
          type="number"
          valeurInitiale={
            àModifier.rateLimit.rxBitsPerSecond
              ? String(àModifier.rateLimit.rxBitsPerSecond / 1_000_000)
              : ''
          }
          enCours={modifier.isPending}
          onAnnuler={() => setÀModifier(null)}
          onValider={(saisie) => {
            const mbps = Number(saisie.replace(',', '.'));
            if (!Number.isFinite(mbps) || mbps <= 0) {
              return 'Le débit doit être un nombre de Mb/s supérieur à zéro.';
            }
            modifier.mutate({
              name: àModifier.name,
              input: { rateLimitRxBitsPerSecond: Math.round(mbps * 1_000_000) },
            });
            setÀModifier(null);
          }}
        />
      )}

      {canWrite && (
        <Card title="Créer une limitation">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <FormField label="Nom">
              <Input
                value={form.name}
                placeholder="BRIDAGE-2M"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </FormField>
            <FormField label="Descendant (Mb/s)">
              <Input
                type="number"
                min={1}
                value={
                  form.rateLimitRxBitsPerSecond ? form.rateLimitRxBitsPerSecond / 1_000_000 : ''
                }
                onChange={(e) =>
                  setForm({
                    ...form,
                    rateLimitRxBitsPerSecond: e.target.value
                      ? Number(e.target.value) * 1_000_000
                      : null,
                  })
                }
              />
            </FormField>
            <FormField label="Montant (Mb/s)">
              <Input
                type="number"
                min={1}
                value={
                  form.rateLimitTxBitsPerSecond ? form.rateLimitTxBitsPerSecond / 1_000_000 : ''
                }
                onChange={(e) =>
                  setForm({
                    ...form,
                    rateLimitTxBitsPerSecond: e.target.value
                      ? Number(e.target.value) * 1_000_000
                      : null,
                  })
                }
              />
            </FormField>
            <FormField label="Volume (Go)">
              <Input
                type="number"
                min={1}
                value={form.transferLimitBytes ? form.transferLimitBytes / 1_073_741_824 : ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    transferLimitBytes: e.target.value
                      ? Math.round(Number(e.target.value) * 1_073_741_824)
                      : null,
                  })
                }
              />
            </FormField>
            <div className="flex items-end">
              <Button type="submit" disabled={create.isPending} className="w-full">
                {create.isPending ? 'Création…' : 'Créer'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {limitations.isLoading ? (
        <p className="text-slate-500">Chargement…</p>
      ) : (
        <Table head={['Limitation', 'Descendant', 'Montant', 'Volume', 'Durée', 'Profils', '']}>
          {limitations.data?.map((limitation) => (
            <tr key={limitation.id}>
              <td className="px-3 py-2 font-medium">{limitation.name}</td>
              <td className="px-3 py-2">{formatRate(limitation.rateLimit.rxBitsPerSecond)}</td>
              <td className="px-3 py-2">{formatRate(limitation.rateLimit.txBitsPerSecond)}</td>
              <td className="px-3 py-2">{formatBytes(limitation.transferLimitBytes)}</td>
              <td className="px-3 py-2">{formatDuration(limitation.uptimeLimitSeconds)}</td>
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
                      <Button variant="danger" onClick={() => remove.mutate(limitation.name)}>
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
  const [àRecoder, setÀRecoder] = useState<string | null>(null);
  const [àSupprimer, setÀSupprimer] = useState<string | null>(null);

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
      refresh();
    },
    onError,
  });
  const toggle = useMutation({
    mutationFn: ({ username, disabled }: { username: string; disabled: boolean }) =>
      userManagerApi.setAccountDisabled(username, disabled, currentId),
    onSuccess: () => {
      setError(null);
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
      refresh();
    },
    onError,
  });

  const supprimer = useMutation({
    mutationFn: (username: string) => userManagerApi.deleteAccount(username, currentId),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError,
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.username.trim() || !form.password) {
      setError('Le nom du compte et le mot de passe sont requis');
      return;
    }
    create.mutate(form);
  }

  const visible = accounts.data?.filter((a) => !sourceFilter || a.source === sourceFilter);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {àRecoder && (
        <EditionUnChamp
          titre={`Nouveau code pour « ${àRecoder} »`}
          description={
            <>
              Le compte garde son nom, ses attributions et sa validité déjà courue : seul le code
              à saisir change. C'est ce qu'il faut quand un ticket a été lu à voix haute ou
              recopié par quelqu'un d'autre.
            </>
          }
          libellé="Nouveau code"
          placeholder="celui que le client saisira"
          enCours={changerCode.isPending}
          onAnnuler={() => setÀRecoder(null)}
          onValider={(code) => {
            if (!code.trim()) return 'Indiquez le nouveau code.';
            changerCode.mutate({ username: àRecoder, password: code.trim() });
            setÀRecoder(null);
          }}
        />
      )}

      {àSupprimer && (
        <ConfirmationInline
          titre={`Supprimer définitivement « ${àSupprimer} » ?`}
          libelléConfirmer="Supprimer quand même"
          enCours={supprimer.isPending}
          onAnnuler={() => setÀSupprimer(null)}
          onConfirmer={() => {
            supprimer.mutate(àSupprimer);
            setÀSupprimer(null);
          }}
        >
          Son historique de sessions part avec, et rien ne le rendra. Pour couper l'accès sans
          rien perdre, <strong>Suspendre</strong> suffit — le compte reste, il ne répond plus.
        </ConfirmationInline>
      )}

      {canWrite && (
        <Card title="Créer un compte">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-5">
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
            <div className="flex items-end">
              <Button type="submit" disabled={create.isPending} className="w-full">
                {create.isPending ? 'Création…' : 'Créer'}
              </Button>
            </div>
          </form>
        </Card>
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
        <span className="text-sm text-slate-400">
          {visible?.length ?? 0} compte{(visible?.length ?? 0) > 1 ? 's' : ''}
        </span>
      </div>

      {accounts.isLoading ? (
        <p className="text-slate-500">Chargement…</p>
      ) : (
        <Table head={['Compte', 'Origine', 'Client', 'Profil', 'Échéance', 'État', '']}>
          {visible?.map((account) => (
            <tr key={account.username} className={account.disabled ? 'bg-red-50/50' : undefined}>
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
              <td className="px-3 py-2 text-slate-500">
                {account.endTime
                  ? new Date(account.endTime).toLocaleString('fr-FR')
                  : account.state === 'waiting'
                    ? 'pas encore utilisé'
                    : '—'}
              </td>
              <td className="px-3 py-2">
                {account.disabled ? (
                  <Badge tone="red">suspendu</Badge>
                ) : account.state === 'running-active' ? (
                  <Badge tone="green">en cours</Badge>
                ) : account.state === 'used' ? (
                  <Badge tone="slate">consommé</Badge>
                ) : (
                  <Badge tone="slate">{account.state ?? 'sans profil'}</Badge>
                )}
              </td>
              <td className="px-3 py-2">
                {canWrite && (
                  <div className="flex justify-end gap-1">
                    <Button variant="secondary" onClick={() => setÀRecoder(account.username)}>
                      Changer le code
                    </Button>
                    <Button
                      variant={account.disabled ? 'secondary' : 'danger'}
                      onClick={() =>
                        toggle.mutate({ username: account.username, disabled: !account.disabled })
                      }
                    >
                      {account.disabled ? 'Réactiver' : 'Suspendre'}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => setÀSupprimer(account.username)}
                    >
                      Supprimer
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {visible?.length === 0 && (
            <EmptyRow colSpan={7}>Aucun compte pour ce filtre.</EmptyRow>
          )}
        </Table>
      )}
    </div>
  );
}
