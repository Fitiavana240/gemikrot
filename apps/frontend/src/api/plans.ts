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

/**
 * La validité d'une offre, **en heures**.
 *
 * Distincte de `formatDuration`, qui choisit l'unité la plus naturelle et
 * reste juste partout ailleurs — un temps consommé, un délai de session. Ici
 * c'est ce qui se vend : l'exploitant compte en heures, ses offres portent ce
 * mot dans leur nom, et mélanger les unités oblige à convertir au comptoir.
 */
export function validitéEnHeures(secondes: number): string {
  if (secondes <= 0) return 'sans limite';
  if (secondes < 3600) return `${Math.round(secondes / 60)} min`;
  const heures = secondes / 3600;
  return `${Number.isInteger(heures) ? heures : heures.toFixed(1).replace('.', ',')} h`;
}
