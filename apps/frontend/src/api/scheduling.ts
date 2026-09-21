import { api } from './client';

/**
 * Ce que les travaux de fond feraient, sans qu'ils le fassent.
 *
 * Les deux listes sont vides quand rien n'est échu : allumer l'ordonnanceur
 * ne couperait alors rien. C'est la question qu'on se pose avant de l'allumer,
 * et elle demandait jusqu'ici de lire le code et d'interroger la base.
 */
export interface ApercuOrdonnanceur {
  actif: boolean;
  ticketsAExpirer: { code: string; expiresAt: string | null }[];
  abonnesASuspendre: { username: string; graceEndsAt: string }[];
}

export const schedulingApi = {
  apercu: () => api.get<ApercuOrdonnanceur>('/scheduling/apercu'),
};
