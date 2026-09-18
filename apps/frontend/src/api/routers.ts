import { api } from './client';

export interface RouterView {
  id: string;
  label: string;
  host: string;
  restPort: number;
  tlsFingerprint: string | null;
  status: string;
  lastSeenAt: string | null;
}

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
