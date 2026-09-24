import { api } from './client';

/** Ce que le disjoncteur a observé, par opposition au statut enregistré. */
export type RouterReachability = 'JOIGNABLE' | 'INJOIGNABLE' | 'REPOND_MAL' | 'INCONNU';

export interface RouterHealth {
  state: RouterReachability;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorMessage: string | null;
  /** Les appels sont suspendus le temps du repos du disjoncteur. */
  suspended: boolean;
}

export interface RouterView {
  id: string;
  label: string;
  host: string;
  restPort: number;
  tlsFingerprint: string | null;
  status: string;
  lastSeenAt: string | null;
  health: RouterHealth;
}

/**
 * Chaque état a deux formes, et elles ne sont pas interchangeables.
 *
 * `label` tient dans une pastille ; `phrase` se met derrière un nom de
 * routeur. Coller le premier après « est » donnait « est pas encore
 * interrogé » — un français cassé, sur l'écran le plus consulté. Un libellé
 * de badge n'est pas un morceau de phrase, et vouloir les confondre casse
 * toujours sur le cas qu'on n'avait pas en tête.
 */
export const REACHABILITY_LABEL: Record<
  RouterReachability,
  { label: string; phrase: string; tone: 'green' | 'amber' | 'red' | 'slate' }
> = {
  JOIGNABLE: { label: 'joignable', phrase: 'est joignable', tone: 'green' },
  INJOIGNABLE: { label: 'injoignable', phrase: 'ne répond pas', tone: 'red' },
  // Le routeur répond mais refuse : identifiants, service REST, droits.
  REPOND_MAL: { label: 'répond mal', phrase: 'répond mal', tone: 'amber' },
  INCONNU: {
    label: 'pas encore interrogé',
    phrase: "n'a pas encore été interrogé",
    tone: 'slate',
  },
};

export interface ConnectionTest {
  reachable: boolean;
  identity?: { name: string };
  version?: string;
  uptime?: string;
  error?: string;
}

export interface ImportReport {
  routerId: string;
  dryRun: boolean;
  plans: { created: number; updated: number; needingPriceReview: number };
  customers: { created: number; matched: number };
  subscriptions: { created: number; updated: number };
  devices: { created: number; updated: number };
  skipped: { name: string; reason: string }[];
}

/**
 * Écriture vers le routeur qui n'a pas pu partir et sera rejouée. Le client
 * final n'est pas coupé pour autant : le routeur applique seul les validités.
 */
export interface RouterOperation {
  id: string;
  routerId: string;
  kind: 'COUPER_ACCES' | 'BASCULER_COMPTE';
  reason: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export const OPERATION_LABEL: Record<RouterOperation['kind'], string> = {
  COUPER_ACCES: "Coupure d'accès",
  BASCULER_COMPTE: "Changement d'état d'un compte",
};

/**
 * Invitation à raccorder un routeur. Le script n'est rendu qu'à la création :
 * il porte le jeton et le mot de passe d'API en clair, et n'est jamais relu.
 */
export interface EnrollmentInvitation {
  id: string;
  label: string;
  tunnelAddress: string;
  expiresAt: string;
  script: string;
  /** L'adresse que le routeur appellera, telle qu'elle figure dans le script. */
  endpoint: string;
  /**
   * Vrai quand cette adresse est privée : le script ne vaut alors que sur le
   * réseau local, et l'échec d'un routeur distant serait muet.
   */
  endpointPrive: boolean;
  /**
   * L'adresse annoncee au routeur n'est plus celle de la machine qui repond.
   *
   * `null` quand tout va bien, ou quand c'est un nom de domaine : celui-la ne
   * perime pas.
   */
  adressePerimee: { configuree: string; actuelle: string | null } | null;
}

/** Ce que la console a trouve sur le routeur, sans rien y ecrire. */
export interface SondageRouteur {
  joignable: boolean;
  version: string | null;
  versionSuffisante: boolean;
  identite: string | null;
  modele: string | null;
  empreinte: string | null;
  message: string;
  adressePerimee: { configuree: string; actuelle: string | null } | null;
}

export interface RaccordementAssiste {
  routerId: string;
  label: string;
  identite: string;
  version: string;
  tunnelAddress: string;
  /** Les gestes poses sur le routeur, dans l'ordre. */
  etapes: string[];
}

/**
 * Les identifiants Winbox, employes une fois puis oublies.
 *
 * Le mot de passe part au serveur, qui s'en sert le temps de trois ecritures
 * et ne l'enregistre nulle part. Ce qui reste, c'est un compte dedie aux
 * droits limites dont le mot de passe est fabrique par le serveur.
 */
export interface RaccordementAssisteInput {
  host: string;
  port?: number;
  username: string;
  password: string;
  label?: string;
}

/**
 * L'etat du serveur de tunnel.
 *
 * Le pair se pose sur le routeur et le routeur se met a appeler. Si personne
 * n'ecoute en face, rien ne le dit : WireGuard n'a pas d'erreur, les octets
 * sortants montent, les entrants restent a zero.
 */
export interface EtatServeurTunnel {
  endpoint: string;
  endpointPrive: boolean;
  pilote: boolean;
  interfaceName: string;
  manques: string[];
  pairs: { label: string; commande: string }[];
}

export interface PendingEnrollment {
  id: string;
  label: string;
  tunnelAddress: string;
  expiresAt: string;
  createdAt: string;
}

export const enrollmentsApi = {
  pending: () => api.get<PendingEnrollment[]>('/router-enrollments'),
  invite: (label: string) => api.post<EnrollmentInvitation>('/router-enrollments', { label }),
  serveur: () => api.get<EtatServeurTunnel>('/router-enrollments/serveur'),
  sonder: (input: RaccordementAssisteInput) =>
    api.post<SondageRouteur>('/router-enrollments/sonder', input),
  raccorder: (input: RaccordementAssisteInput) =>
    api.post<RaccordementAssiste>('/router-enrollments/assiste', input),
  /** Retire une invitation qu'on ne compte plus servir, et libère son adresse. */
  cancel: (id: string) => api.delete<void>(`/router-enrollments/${id}`),
};

/**
 * L'état d'un routeur en un appel : qui il est, ce qu'il fait tourner, et
 * quelle heure il est chez lui.
 *
 * L'horloge en fait partie parce que c'est **elle** qui décide des
 * expirations. Une console dont la pendule avance sur celle du routeur
 * annonce des coupures qui n'ont pas eu lieu, et l'écart ne se voit nulle
 * part tant que personne ne montre les deux.
 */
export interface EtatRouteur {
  identity: { name: string };
  resource: {
    uptime: string;
    version: string;
    boardName: string;
    architectureName: string;
    cpuLoadPercent: number;
    freeMemoryBytes: number;
    totalMemoryBytes: number;
  };
  ntp: { enabled: boolean; status: string; servers: string[] };
  clock: { time: string; date: string; timeZone: string; gmtOffset: string };
}

export const routersApi = {
  list: () => api.get<RouterView[]>('/routers'),
  etat: (id: string) => api.get<EtatRouteur>(`/routers/${id}/status`),
  pendingOperations: (routerId?: string) =>
    api.get<RouterOperation[]>(
      `/routers/operations/pending${routerId ? `?routerId=${routerId}` : ''}`,
    ),
  drainOperations: (routerId: string) =>
    api.post<{ done: number; failed: number; abandoned: number }>(
      `/routers/${routerId}/operations/drain`,
    ),
  testConnection: (id: string) => api.get<ConnectionTest>(`/routers/${id}/test-connection`),
  import: (id: string, dryRun: boolean) =>
    api.post<ImportReport>(`/routers/${id}/import?dryRun=${dryRun}`),
  /**
   * Retire la fiche de la console. **Refuse si le routeur porte quelque
   * chose**, et dit quoi : le serveur ne supprime jamais en cascade.
   *
   * N'ecrit rien sur le routeur. Le tunnel, le compte applicatif et le
   * certificat poses par le script y restent.
   */
  supprimer: (id: string) => api.delete<{ supprime: true }>(`/routers/${id}`),
};
