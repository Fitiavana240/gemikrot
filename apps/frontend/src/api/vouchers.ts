import { api } from './client';
import type { Voucher, VoucherStatus } from './types';

export interface GenerateBatchInput {
  planId: string;
  quantity: number;
  prefix?: string;
  routerId?: string;
}

export const vouchersApi = {
  get: (id: string) => api.get<Voucher>(`/vouchers/${id}`),
  list: (filter: { status?: VoucherStatus; planId?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.planId) params.set('planId', filter.planId);
    const qs = params.toString();
    return api.get<Voucher[]>(`/vouchers${qs ? `?${qs}` : ''}`);
  },
  generateBatch: (input: GenerateBatchInput) => api.post<Voucher[]>('/vouchers/batches', input),
  disable: (id: string) => api.patch<Voucher>(`/vouchers/${id}/disable`),
  cancel: (id: string) => api.patch<Voucher>(`/vouchers/${id}/cancel`),
};
