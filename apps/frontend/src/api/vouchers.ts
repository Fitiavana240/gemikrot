import { api } from './client';
import type { Voucher, VoucherStatus } from './types';

/**
 * Où créer les comptes d'un lot.
 *
 * User Manager par défaut, et c'est le bon choix : lui seul tient une
 * validité **calendaire**, qui continue de courir client déconnecté. Sur le
 * HotSpot, le plafond compte le temps passé connecté — un forfait d'un mois
 * y devient 720 h de connexion, ce qui n'est pas le même produit.
 */
export type CibleLot = 'USER_MANAGER' | 'HOTSPOT';

export interface GenerateBatchInput {
  planId: string;
  quantity: number;
  prefix?: string;
  routerId?: string;
  target?: CibleLot;
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
  /**
   * Opérations que le routeur n'a pas pu recevoir, mises en attente.
   *
   * Le serveur le rend depuis toujours ; ce type l'ignorait, si bien qu'un
   * écran ne pouvait pas dire qu'une coupure restait à appliquer.
   */
  deferred: number;
  /**
   * Codes des tickets qu'aucun compte ne porte sur le routeur.
   *
   * Un ticket « vendu » dans cette liste veut dire qu'un client a payé pour
   * un code qui n'ouvre rien. La réconciliation les rencontrait et passait au
   * suivant sans un mot.
   */
  sansCompte: string[];
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
  /**
   * Planches A4 écrites sur le routeur pour ce lot, chemins complets.
   *
   * Le PDF vit sur la clé USB du routeur, pas dans cette application : sans ce
   * chemin à l'écran, on ne saurait pas où le reprendre. Vide quand l'écriture
   * a échoué — les tickets, eux, existent quand même.
   */
  planches?: string[];
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
