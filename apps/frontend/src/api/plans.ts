import { api } from './client';
import type { Plan, StartsWhen } from './types';

export interface CreatePlanInput {
  name: string;
  description?: string;
  price: number;
  validityDurationSeconds: number;
  startsWhen: StartsWhen;
  rateLimitRxBps?: number;
  rateLimitTxBps?: number;
  transferLimitBytes?: number;
  maxSharedUsers?: number;
}

export const plansApi = {
  list: () => api.get<Plan[]>('/plans'),
  /** Modifier une offre existante : le prix change, l'historique reste. */
  update: (id: string, input: Partial<CreatePlanInput>) =>
    api.patch<Plan>(`/plans/${id}`, input),
  /** Repousser l'offre vers User Manager quand le routeur a divergé. */
  syncUserManager: (id: string) =>
    api.post<{ profileName: string; actions: string[] }>(`/plans/${id}/sync-user-manager`),
  create: (input: CreatePlanInput) => api.post<Plan>('/plans', input),
  archive: (id: string) => api.delete<Plan>(`/plans/${id}`),
};
