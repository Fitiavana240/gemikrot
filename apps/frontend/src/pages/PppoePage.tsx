import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pppApi, type PppSecret, type UpdatePppSecret } from '../api/ppp';
import { formatOctets, formatDuree } from '../api/mikrotik-tabs';
import { formatBits } from '../api/router-tools';
import { ListeDuRouteur } from '../components/ListeDuRouteur';
import { useRouterSelection } from '../routers/RouterContext';
import { TabBar, type TabDef } from '../components/TabBar';

import { MenuAction } from '../components/MenuAction';
import { Modale } from '../components/Modale';
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
  TableSkeleton,
} from '../components/ui';

/**
 * PPPoE — l'abonné raccordé à demeure.
 *
 * Le HotSpot authentifie un navigateur derrière un portail ; PPPoE
 * authentifie la connexion elle-même. C'est ce qu'on pose chez quelqu'un qui
 * paie au mois et n'a pas à ouvrir une page pour être en ligne.
 *
 * Quatre des cinq tables ont été relevées sur le matériel. La cinquième —
 * les sessions actives — ne l'a jamais été, faute d'un seul PPPoE en service
 * dans le parc : l'écran le dit au lieu de laisser croire.
 */

function useRouteur() {
  const { currentId } = useRouterSelection();
  return currentId;
}


/**
 * Le formulaire d'un compte, en création comme en modification.
 *
 * Un seul formulaire pour les deux, parce que les champs sont les mêmes et
 * que deux copies divergent. La différence tient en deux points : le nom est
 * figé en modification (il identifie le compte, le changer en créerait un
 * autre), et le mot de passe vide y veut dire « ne pas toucher » plutôt que
 * « vide ».
 */
function FormulaireCompte({
  compte,
  profils,
  onValider,
  onAnnuler,
  enCours,
}: {
  compte?: PppSecret;
  profils: string[];
  onValider: (valeurs: {
    username: string;
    password: string;
    profile: string;
    service: string;
    remoteAddress: string;
    comment: string;
  }) => void;
  onAnnuler: () => void;
  enCours: boolean;
}) {
  const modification = compte != null;
  const [username, setUsername] = useState(compte?.username ?? '');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState(compte?.profile ?? '');
  const [service, setService] = useState(compte?.service ?? 'pppoe');
  const [remoteAddress, setRemoteAddress] = useState(compte?.remoteAddress ?? '');
  const [comment, setComment] = useState(compte?.comment ?? '');

  const valider = () =>
    onValider({ username, password, profile, service, remoteAddress, comment });

  return (
    <Modale
      titre={modification ? `Modifier « ${compte.username} »` : 'Nouveau compte PPPoE'}
      onFermer={onAnnuler}
      actions={
        <Button disabled={enCours} onClick={valider}>
          {enCours ? 'Enregistrement…' : modification ? 'Enregistrer' : 'Créer le compte'}
        </Button>
      }
      note={
        modification ? (
          <>
            Le nom ne se change pas : il identifie le compte côté routeur, et le modifier
            reviendrait à en créer un autre sans son historique. Un mot de passe laissé vide
            reste celui d&apos;avant.
          </>
        ) : (
          <>
            Un compte PPPoE ouvre une <strong>liaison dédiée</strong>, pas un accès HotSpot :
            l&apos;abonné se connecte avec ce nom et ce mot de passe depuis son propre
            routeur. Sans <em>adresse imposée</em>, il reçoit une adresse du bassin de son
            profil.
          </>
        )
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          valider();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Nom du compte">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              // Le nom identifie le compte côté routeur : le changer
              // reviendrait à en créer un autre, sans son historique.
              disabled={modification}
              placeholder="rakoto-antaninarenina"
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
            <Select value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="">default (profil du serveur)</option>
              {profils.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Service">
            <Select value={service} onChange={(e) => setService(e.target.value)}>
              {['pppoe', 'any', 'pptp', 'l2tp', 'ovpn', 'sstp'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Adresse imposée">
            <Input
              value={remoteAddress}
              onChange={(e) => setRemoteAddress(e.target.value)}
              placeholder="vide = bassin du profil"
            />
          </FormField>
          <FormField label="Commentaire">
            <Input value={comment} onChange={(e) => setComment(e.target.value)} />
          </FormField>
        </div>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modale>
  );
}

function ComptesTab() {
  const routerId = useRouteur();
  const client = useQueryClient();
  const [formulaire, setFormulaire] = useState<'aucun' | 'creation' | PppSecret>('aucun');
  /** Le compte sur lequel on agit : les gestes sont exclusifs, l'état l'est aussi. */
  const [actionSur, setActionSur] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const comptes = useQuery({
    queryKey: ['ppp-secrets', routerId],
    queryFn: () => pppApi.secrets(routerId!),
    enabled: Boolean(routerId),
  });
  const profils = useQuery({
    queryKey: ['ppp-profiles', routerId],
    queryFn: () => pppApi.profiles(routerId!),
    enabled: Boolean(routerId),
  });

  const rafraîchir = () => {
    void client.invalidateQueries({ queryKey: ['ppp-secrets', routerId] });
    setFormulaire('aucun');
    setErreur(null);
  };
  const échouer = (e: unknown) => setErreur(e instanceof Error ? e.message : String(e));

  const créer = useMutation({
    mutationFn: (v: Parameters<Parameters<typeof FormulaireCompte>[0]['onValider']>[0]) =>
      pppApi.create(routerId!, {
        username: v.username,
        password: v.password,
        ...(v.profile ? { profile: v.profile } : {}),
        service: v.service,
        ...(v.remoteAddress ? { remoteAddress: v.remoteAddress } : {}),
        ...(v.comment ? { comment: v.comment } : {}),
      }),
    onSuccess: rafraîchir,
    onError: échouer,
  });

  const modifier = useMutation({
    mutationFn: ({ username, dto }: { username: string; dto: UpdatePppSecret }) =>
      pppApi.update(routerId!, username, dto),
    onSuccess: rafraîchir,
    onError: échouer,
  });

  const suspendre = useMutation({
    mutationFn: ({ username, disabled }: { username: string; disabled: boolean }) =>
      pppApi.setDisabled(routerId!, username, disabled),
    onSuccess: rafraîchir,
    onError: échouer,
  });

  const supprimer = useMutation({
    mutationFn: (username: string) => pppApi.remove(routerId!, username),
    // La fenêtre se referme ici, et non au clic : fermer avant la réponse du
    // routeur faisait lire « c'est fait » sur un refus.
    onSuccess: () => {
      setActionSur(null);
      rafraîchir();
    },
    onError: échouer,
  });

  const nomsProfils = (profils.data ?? []).map((p) => p.name);

  return (
    <div className="space-y-4">
      {erreur && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {erreur}
        </div>
      )}

      {actionSur &&
        (() => {
          const compte = (comptes.data ?? []).find((c) => c.username === actionSur);
          if (!compte) return null;
          return (
            <MenuAction
              titre={`Compte PPPoE « ${actionSur} »`}
              enCours={suspendre.isPending || supprimer.isPending}
              erreur={suspendre.isError || supprimer.isError ? erreur : null}
              onFermer={() => {
                setErreur(null);
                setActionSur(null);
              }}
              options={[
                compte.disabled
                  ? {
                      clé: 'reactiver',
                      libellé: 'Réactiver',
                      aide: "L'abonné pourra de nouveau ouvrir sa liaison, avec le même mot de passe.",
                    }
                  : {
                      clé: 'suspendre',
                      libellé: 'Suspendre',
                      aide: "Le compte reste et garde tout ; il cesse d'être accepté. La session en cours ne se ferme pas — PPPoE ne revérifie qu'à la reconnexion, il faut aussi la fermer dans l'onglet Sessions.",
                    },
                {
                  clé: 'modifier',
                  libellé: 'Modifier',
                  aide: 'Profil, service, adresse imposée, commentaire, mot de passe. Le nom, lui, ne se change pas : il identifie le compte côté routeur.',
                  libelléBouton: 'Ouvrir le formulaire',
                },
                {
                  clé: 'supprimer',
                  libellé: 'Supprimer',
                  aide: "Son historique de connexions part avec, et le routeur ne le rejoue pas. Pour couper l'accès sans rien perdre, Suspendre suffit.",
                  danger: true,
                  libelléBouton: 'Supprimer définitivement',
                },
              ]}
              onAppliquer={(clé) => {
                setErreur(null);
                if (clé === 'modifier') {
                  setActionSur(null);
                  setFormulaire(compte);
                } else if (clé === 'supprimer') {
                  supprimer.mutate(actionSur);
                } else {
                  suspendre.mutate({ username: actionSur, disabled: clé === 'suspendre' });
                }
              }}
            />
          );
        })()}

      {/* L'en-tête reste : c'est la fenêtre qui recouvre la liste, plus le
          formulaire qui la pousse hors de vue. */}
      <div className="flex justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">
          Un compte par abonné raccordé. Suspendre ne coupe pas la session en cours — PPPoE ne
          revérifie l'authentification qu'à la reconnexion ; pour couper tout de suite, fermez
          aussi sa session dans l'onglet Sessions.
        </p>
        <Button onClick={() => setFormulaire('creation')}>Nouveau compte</Button>
      </div>

      {formulaire !== 'aucun' && (
        <FormulaireCompte
          compte={formulaire === 'creation' ? undefined : formulaire}
          profils={nomsProfils}
          enCours={créer.isPending || modifier.isPending}
          onAnnuler={() => {
            setFormulaire('aucun');
            setErreur(null);
          }}
          onValider={(v) => {
            setErreur(null);
            if (formulaire === 'creation') {
              créer.mutate(v);
              return;
            }
            // Ne transmettre que ce qui a changé : renvoyer tout écraserait
            // un réglage posé ailleurs entre-temps. Un mot de passe vide
            // veut dire « ne pas y toucher », pas « effacer ».
            const dto: UpdatePppSecret = {};
            if (v.password) dto.password = v.password;
            if (v.profile !== (formulaire.profile ?? '')) dto.profile = v.profile;
            if (v.service !== formulaire.service) dto.service = v.service;
            if (v.remoteAddress !== (formulaire.remoteAddress ?? '')) {
              dto.remoteAddress = v.remoteAddress;
            }
            if (v.comment !== (formulaire.comment ?? '')) dto.comment = v.comment;

            if (Object.keys(dto).length === 0) {
              setFormulaire('aucun');
              return;
            }
            modifier.mutate({ username: formulaire.username, dto });
          }}
        />
      )}

      <ListeDuRouteur
        requête={comptes}
        colonnes={['Compte', 'Profil', 'Service', 'Adresse', 'Consommé', 'État', '']}
        vide={{
          titre: 'Aucun compte PPPoE',
          aide: "Ce routeur ne sert que le HotSpot. Créez un compte pour raccorder un abonné à demeure.",
        }}
        ligne={(c) => (
          <tr key={c.id} className={c.disabled ? 'opacity-60' : undefined}>
            <td className="px-3 py-2 font-medium">{c.username}</td>
            <td className="px-3 py-2 text-slate-500">
              {c.profile ?? <span className="text-slate-400">default</span>}
            </td>
            <td className="px-3 py-2 text-xs text-slate-500">{c.service}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">
              {c.remoteAddress ?? '—'}
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {c.limitBytesIn != null || c.limitBytesOut != null
                ? `${formatOctets(c.limitBytesIn ?? 0)} / ${formatOctets(c.limitBytesOut ?? 0)}`
                : '—'}
            </td>
            <td className="px-3 py-2">
              <Badge tone={c.disabled ? 'red' : 'green'}>{c.disabled ? 'suspendu' : 'actif'}</Badge>
            </td>
            <td className="px-3 py-2">
              {/* Un seul bouton : c'est la fenêtre qui porte le choix. */}
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => setActionSur(c.username)}>
                  Action…
                </Button>
              </div>
            </td>
          </tr>
        )}
      />
    </div>
  );
}

function ProfilsTab() {
  const routerId = useRouteur();
  const requête = useQuery({
    queryKey: ['ppp-profiles', routerId],
    queryFn: () => pppApi.profiles(routerId!),
    enabled: Boolean(routerId),
  });

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Les profils portent le débit, comme les offres du HotSpot. Un compte sans profil reçoit
        celui du serveur. Ces tables sont en lecture : créer un profil PPPoE suppose de choisir un
        bassin d'adresses et une politique de routage, ce qui se fait une fois, dans WinBox.
      </p>
      <ListeDuRouteur
        requête={requête}
        colonnes={['Profil', 'Débit ↓', 'Débit ↑', 'Adresse locale', 'Bassin distant', 'DNS']}
        vide={{ titre: 'Aucun profil PPPoE' }}
        ligne={(p) => (
          <tr key={p.id}>
            <td className="px-3 py-2 font-medium">
              <span className="mr-2">{p.name}</span>
              {/* Le hAP marque `default` sur ses **deux** profils livrés :
                  le drapeau ne désigne donc pas « celui utilisé par défaut »
                  — il ne peut y en avoir qu'un — mais un profil intégré, que
                  RouterOS refuse de supprimer. */}
              {p.isDefault && <Badge tone="slate">intégré</Badge>}
            </td>
            <td className="px-3 py-2 tabular-nums">
              {p.rateLimitRxBitsPerSecond != null ? formatBits(p.rateLimitRxBitsPerSecond) : '—'}
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {p.rateLimitTxBitsPerSecond != null ? formatBits(p.rateLimitTxBitsPerSecond) : '—'}
            </td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">{p.localAddress ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">{p.remoteAddress ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">{p.dnsServer ?? '—'}</td>
          </tr>
        )}
      />
    </div>
  );
}

function SessionsTab() {
  const routerId = useRouteur();
  const client = useQueryClient();
  const requête = useQuery({
    queryKey: ['ppp-active', routerId],
    queryFn: () => pppApi.active(routerId!),
    enabled: Boolean(routerId),
    refetchInterval: 15_000,
  });

  const fermer = useMutation({
    mutationFn: (id: string) => pppApi.disconnect(routerId!, id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['ppp-active', routerId] }),
  });

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>Table non vérifiée sur matériel.</strong> Les quatre autres tables de cet écran ont
        été relevées sur un vrai routeur ; celle-ci ne l'a jamais été, le parc n'ayant aucun PPPoE
        en service au moment du relevé. Si une colonne reste vide alors qu'un abonné est bien
        connecté, c'est le nom du champ qui est faux, pas le routeur — signalez-le.
      </div>
      <ListeDuRouteur
        requête={requête}
        colonnes={['Compte', 'Adresse', 'Appareil', 'Depuis', 'Reçu', 'Envoyé', '']}
        vide={{
          titre: 'Aucune session PPPoE',
          aide: 'Personne n\'est connecté en PPPoE en ce moment.',
        }}
        ligne={(s) => (
          <tr key={s.id}>
            <td className="px-3 py-2 font-medium">{s.username}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">{s.address ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">{s.callerId ?? '—'}</td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {formatDuree(s.uptimeSeconds)}
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {s.bytesIn != null ? formatOctets(s.bytesIn) : '—'}
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {s.bytesOut != null ? formatOctets(s.bytesOut) : '—'}
            </td>
            <td className="px-3 py-2 text-right">
              <Button variant="secondary" onClick={() => fermer.mutate(s.id)}>
                Déconnecter
              </Button>
            </td>
          </tr>
        )}
      />
    </div>
  );
}

function ServeursTab() {
  const routerId = useRouteur();
  const requête = useQuery({
    queryKey: ['ppp-servers', routerId],
    queryFn: () => pppApi.servers(routerId!),
    enabled: Boolean(routerId),
  });

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Le serveur écoute sur une interface et propose un nom de service. Sans serveur actif,
        aucun compte PPPoE ne peut se connecter — quels que soient les comptes déclarés.
      </p>
      <ListeDuRouteur
        requête={requête}
        colonnes={['Service', 'Interface', 'Profil par défaut', 'Authentification', 'Sessions', 'État']}
        vide={{
          titre: 'Aucun serveur PPPoE',
          aide: "Ce routeur ne sert pas de PPPoE : les comptes déclarés ne peuvent pas se connecter.",
        }}
        ligne={(s) => (
          <tr key={s.id} className={s.disabled ? 'opacity-60' : undefined}>
            <td className="px-3 py-2 font-medium">{s.serviceName || '—'}</td>
            <td className="px-3 py-2 font-mono text-xs">{s.interfaceName}</td>
            <td className="px-3 py-2 text-slate-500">{s.defaultProfile ?? '—'}</td>
            <td className="px-3 py-2 text-xs text-slate-500">
              {s.authentication.length ? s.authentication.join(', ') : '—'}
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {s.maxSessions ?? 'illimité'}
              {s.oneSessionPerHost && (
                <span className="ml-1 text-xs">· une par appareil</span>
              )}
            </td>
            <td className="px-3 py-2">
              <Badge tone={s.disabled ? 'red' : 'green'}>{s.disabled ? 'arrêté' : 'actif'}</Badge>
            </td>
          </tr>
        )}
      />
    </div>
  );
}

function BassinsTab() {
  const routerId = useRouteur();
  const requête = useQuery({
    queryKey: ['ppp-pools', routerId],
    queryFn: () => pppApi.pools(routerId!),
    enabled: Boolean(routerId),
  });

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Les adresses distribuées aux abonnés. Un bassin épuisé refuse les connexions suivantes
        sans autre explication qu'un échec d'authentification — d'où la colonne{' '}
        <em>Disponibles</em>.
      </p>
      <ListeDuRouteur
        requête={requête}
        colonnes={['Bassin', 'Plages', 'Total', 'Utilisées', 'Disponibles']}
        vide={{ titre: 'Aucun bassin déclaré' }}
        ligne={(p) => {
          const épuisé = p.available != null && p.available === 0;
          return (
            <tr key={p.id}>
              <td className="px-3 py-2 font-medium">{p.name}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-500">{p.ranges}</td>
              <td className="px-3 py-2 tabular-nums text-slate-500">{p.total ?? '—'}</td>
              <td className="px-3 py-2 tabular-nums text-slate-500">{p.used ?? '—'}</td>
              <td className="px-3 py-2 tabular-nums">
                {p.available == null ? (
                  '—'
                ) : (
                  <Badge tone={épuisé ? 'red' : p.available < 5 ? 'amber' : 'green'}>
                    {p.available}
                  </Badge>
                )}
              </td>
            </tr>
          );
        }}
      />
    </div>
  );
}

const ONGLETS = {
  comptes: { titre: 'Comptes', rendu: () => <ComptesTab /> },
  profils: { titre: 'Profils', rendu: () => <ProfilsTab /> },
  sessions: { titre: 'Sessions', rendu: () => <SessionsTab /> },
  serveurs: { titre: 'Serveurs', rendu: () => <ServeursTab /> },
  bassins: { titre: "Bassins d'adresses", rendu: () => <BassinsTab /> },
} as const;

type Tab = keyof typeof ONGLETS;

const BARRE: TabDef[] = Object.entries(ONGLETS).map(([to, { titre }]) => ({ to, label: titre }));

export function PppoePage() {
  const { tab } = useParams();
  const courant: Tab = tab && tab in ONGLETS ? (tab as Tab) : 'comptes';
  const { current, isLoading } = useRouterSelection();

  return (
    <div className="space-y-5">
      <PageHeader
        title="PPPoE"
        description="L'abonné raccordé à demeure : la connexion s'authentifie d'elle-même, sans portail à ouvrir. C'est ce qu'on pose chez quelqu'un qui paie au mois."
      />
      {isLoading ? (
        <TableSkeleton columns={5} rows={3} />
      ) : !current ? (
        <EmptyState
          title="Aucun routeur sélectionné"
          hint="Ces tables sont lues en direct : choisissez un routeur dans la barre du haut."
        />
      ) : (
        <>
          <TabBar base="/pppoe" tabs={BARRE} />
          {ONGLETS[courant].rendu()}
        </>
      )}
    </div>
  );
}
