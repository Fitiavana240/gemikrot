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

export const REACHABILITY_LABEL: Record<RouterReachability, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' }> = {
  JOIGNABLE: { label: 'joignable', tone: 'green' },
  INJOIGNABLE: { label: 'injoignable', tone: 'red' },
  // Le routeur répond mais refuse : identifiants, service REST, droits.
  REPOND_MAL: { label: 'répond mal', tone: 'amber' },
  INCONNU: { label: 'pas encore interrogé', tone: 'slate' },
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

export const routersApi = {
  list: () => api.get<RouterView[]>('/routers'),
  testConnection: (id: string) => api.get<ConnectionTest>(`/routers/${id}/test-connection`),
  import: (id: string, dryRun: boolean) =>
    api.post<ImportReport>(`/routers/${id}/import?dryRun=${dryRun}`),
};
