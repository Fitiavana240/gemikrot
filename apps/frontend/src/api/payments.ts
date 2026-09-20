import { api } from './client';
import type { PaymentStatus } from './types';

/**
 * Les statuts d'un paiement, en français et avec leur couleur.
 *
 * Ils s'affichaient bruts — « PENDING », « VERIFIED » — sur la Vue d'ensemble
 * comme sur l'écran Paiements, alors que les tickets et les abonnements sont
 * traduits partout. Posés ici plutôt que dans chaque écran : deux copies
 * finissent par diverger, et c'est toujours celle qu'on ne regarde pas qui
 * reste en anglais.
 */
export const PAYMENT_STATUS: Record<
  PaymentStatus,
  { label: string; tone: 'green' | 'amber' | 'red' | 'slate' }
> = {
  PENDING: { label: 'à vérifier', tone: 'amber' },
  VERIFIED: { label: 'vérifié', tone: 'green' },
  REJECTED: { label: 'refusé', tone: 'red' },
  CANCELLED: { label: 'annulé', tone: 'slate' },
  REFUNDED: { label: 'remboursé', tone: 'slate' },
};
import type { Payment, PaymentMethod } from './types';

export interface CreatePaymentInput {
  customerId: string;
  planId: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
}

export const paymentsApi = {
  list: () => api.get<Payment[]>('/payments'),
  create: (input: CreatePaymentInput) => api.post<Payment>('/payments', input),
  verify: (id: string) => api.post<Payment>(`/payments/${id}/verify`),
  reject: (id: string, reason?: string) => api.post<Payment>(`/payments/${id}/reject`, { reason }),
};
