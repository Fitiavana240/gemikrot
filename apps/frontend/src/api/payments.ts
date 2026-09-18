import { api } from './client';
import type { Payment, PaymentMethod } from './types';

export interface CreatePaymentInput {
  customerId: string;
  planId: string;
  amountAr: number;
  method: PaymentMethod;
  reference: string;
}

export const paymentsApi = {
  list: () => api.get<Payment[]>('/payments'),
  create: (input: CreatePaymentInput) => api.post<Payment>('/payments', input),
  verify: (id: string) => api.post<Payment>(`/payments/${id}/verify`),
  reject: (id: string, reason?: string) => api.post<Payment>(`/payments/${id}/reject`, { reason }),
};
