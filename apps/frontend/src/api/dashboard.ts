import { api, telecharger } from './client';
import type { DashboardSummary } from './types';

export type Pas = 'jour' | 'semaine' | 'mois';

export interface LigneRecette {
  /** Début de la tranche, en ISO. */
  début: string;
  planId: string;
  planName: string;
  nombre: number;
  montant: number;
}

/**
 * La recette d'une période, par tranche et par offre.
 *
 * Seuls les paiements **vérifiés** y entrent, et c'est leur date de
 * vérification qui range chacun dans sa tranche : un règlement déclaré le 31
 * et vérifié le 2 appartient au mois suivant.
 */
export interface Recette {
  devise: string | null;
  du: string;
  au: string;
  pas: Pas;
  total: number;
  nombre: number;
  lignes: LigneRecette[];
  parOffre: { planId: string; planName: string; nombre: number; montant: number }[];
}

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary'),
  recette: (du: string, au: string, pas: Pas) =>
    api.get<Recette>(`/dashboard/recette?du=${du}&au=${au}&pas=${pas}`),
  exportCsv: (du: string, au: string) =>
    telecharger(`/dashboard/recette/export.csv?du=${du}&au=${au}`, `paiements-${du}_${au}.csv`),
};
