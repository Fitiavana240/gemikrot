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
  /**
   * Repousser l'offre vers User Manager **sur le routeur indiqué**.
   *
   * `routerId` n'était pas transmis, et le serveur retombait alors sur le
   * routeur par défaut. Avec plusieurs routeurs, l'écran comparait celui
   * qu'on avait sélectionné et le bouton écrivait sur un autre : l'écart
   * restait affiché, on repoussait, il restait encore. Invisible tant qu'il
   * n'y a qu'un routeur — c'est bien pour cela que ça a tenu si longtemps.
   */
  syncUserManager: (id: string, routerId?: string) =>
    api.post<{ profileName: string; actions: string[] }>(
      `/plans/${id}/sync-user-manager${routerId ? `?routerId=${routerId}` : ''}`,
    ),
  create: (input: CreatePlanInput) => api.post<Plan>('/plans', input),
  archive: (id: string) => api.delete<Plan>(`/plans/${id}`),
  /**
   * Supprime l'offre pour de bon. Refusée dès qu'une vente s'y rattache —
   * le serveur répond alors ce qui la retient, et l'archivage est la réponse.
   */
  supprimer: (id: string) => api.delete<{ id: string; nom: string }>(`/plans/${id}/definitif`),
  /**
   * Met un profil du routeur au tarif que voient les clients.
   *
   * Le sens qui manquait : `syncUserManager` pousse une offre vers le
   * routeur, celui-ci fait entrer dans la vitrine un profil déjà servi —
   * **sans rien écrire sur le routeur**.
   */
  publierAuTarif: (profil: string, routerId?: string) =>
    api.post<{ id: string; nom: string; cree: boolean }>(
      `/plans/tarif-public${routerId ? `?routerId=${routerId}` : ''}`,
      { profil },
    ),
  /** Retire le profil du tarif public. L'offre est archivée, pas supprimée. */
  retirerDuTarif: (profil: string, routerId?: string) =>
    api.post<{ id: string; nom: string }>(
      `/plans/tarif-public/retrait${routerId ? `?routerId=${routerId}` : ''}`,
      { profil },
    ),
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
