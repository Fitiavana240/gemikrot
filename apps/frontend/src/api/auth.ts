import { api } from './client';
import type { AuthUser } from './types';

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/login', { email, password });
}

/**
 * Changer son propre mot de passe.
 *
 * Il n'existait aucun moyen de le faire, ni ici ni côté serveur : un mot de
 * passe éventé ne laissait qu'une porte de sortie, créer un autre compte
 * d'administration et supprimer l'ancien.
 */
export function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true }> {
  return api.post<{ ok: true }>('/auth/change-password', { currentPassword, newPassword });
}
