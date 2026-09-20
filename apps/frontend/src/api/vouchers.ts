import { api } from './client';
import type { Voucher, VoucherStatus } from './types';

export interface GenerateBatchInput {
  planId: string;
  quantity: number;
  prefix?: string;
  routerId?: string;
}

/** Répartition des tickets d'une offre par statut. */
export interface PlanVoucherCounts {
  planId: string;
  planName: string;
  price: string;
  umProfileName: string | null;
  validityDurationSeconds: number;
  counts: Partial<Record<VoucherStatus, number>>;
  total: number;
}

export interface ReconcileReport {
  examined: number;
  expired: number;
  activated: number;
  accessCut: number;
}


/** Un lot genere, avec ce qu'il est devenu. */
export interface VoucherBatchRow {
  id: string;
  quantity: number;
  prefix: string | null;
  status: string;
  createdAt: string;
  plan: { name: string } | null;
  router: { label: string } | null;
  createdByAdmin: { email: string } | null;
  /** Etat de la generation : nul si le lot est anterieur au suivi. */
  job: {
    processed: number;
    total: number;
    status: string;
    errorMessage: string | null;
  } | null;
  decompte: {
    disponibles: number;
    vendus: number;
    expires: number;
    coupes: number;
    /** Reellement cree, pas la quantite demandee : une generation
     *  interrompue en a produit moins. */
    total: number;
  };
}

export const vouchersApi = {
  listBatches: () => api.get<VoucherBatchRow[]>('/vouchers/batches'),
  get: (id: string) => api.get<Voucher>(`/vouchers/${id}`),
  list: (filter: { status?: VoucherStatus; planId?: string; scope?: 'um' | 'legacy' } = {}) => {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.planId) params.set('planId', filter.planId);
    if (filter.scope) params.set('scope', filter.scope);
    const qs = params.toString();
    return api.get<Voucher[]>(`/vouchers${qs ? `?${qs}` : ''}`);
  },
  listExpired: () => api.get<Voucher[]>('/vouchers/expired'),
  countByPlan: () => api.get<PlanVoucherCounts[]>('/vouchers/by-plan'),
  reconcile: () => api.post<ReconcileReport>('/vouchers/reconcile'),
  generateBatch: (input: GenerateBatchInput) => api.post<Voucher[]>('/vouchers/batches', input),
  disable: (id: string) => api.patch<Voucher>(`/vouchers/${id}/disable`),
  cancel: (id: string) => api.patch<Voucher>(`/vouchers/${id}/cancel`),
};
