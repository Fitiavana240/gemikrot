import { api } from './client';
import type { Plan, StartsWhen } from './types';

export interface CreatePlanInput {
  name: string;
  description?: string;
  priceAr: number;
  validityDurationSeconds: number;
  startsWhen: StartsWhen;
  rateLimitRxBps?: number;
  rateLimitTxBps?: number;
  transferLimitBytes?: number;
  maxSharedUsers?: number;
}

export const plansApi = {
  list: () => api.get<Plan[]>('/plans'),
  create: (input: CreatePlanInput) => api.post<Plan>('/plans', input),
  archive: (id: string) => api.delete<Plan>(`/plans/${id}`),
};
