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
  /** Les profils du routeur en face des offres, dans les deux sens. */
  rapprochement: (routerId?: string) =>
    api.get<Rapprochement>(`/plans/rapprochement${routerId ? `?routerId=${routerId}` : ''}`),
  /** Crée une offre **archivée** à partir d'un profil du routeur. */
  creerDepuisProfil: (profil: string, routerId?: string) =>
    api.post<{ id: string; nom: string }>(
      `/plans/depuis-profil${routerId ? `?routerId=${routerId}` : ''}`,
      { profil },
    ),
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

/**
 * Les deux listes, et ce qui les sépare.
 *
 * Une offre sans profil est un risque commercial ; un profil sans offre est
 * de l'argent laissé de côté. Les deux méritent d'être vus.
 */
export interface Rapprochement {
  offres: {
    id: string;
    nom: string;
    statut: 'ACTIVE' | 'ARCHIVED';
    genre: 'TICKET' | 'SUBSCRIPTION';
    prix: string;
    profilUm: string | null;
    profilUmPresent: boolean;
    profilHotspot: string;
    profilHotspotPresent: boolean;
    /** Vendue sur la page publique : c'est là que l'absence coûte. */
    auPublic: boolean;
  }[];
  profilsUmSansOffre: {
    nom: string;
    validiteSecondes: number | null;
    prix: number | null;
    demarre: string;
    appareils: number | null;
  }[];
  profilsHotspotSansOffre: string[];
}
