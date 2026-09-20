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
  /** Retire une invitation qu'on ne compte plus servir, et libère son adresse. */
  cancel: (id: string) => api.delete<void>(`/router-enrollments/${id}`),
};

export const routersApi = {
  list: () => api.get<RouterView[]>('/routers'),
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
};
