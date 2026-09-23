import { api } from './client';
import type { AdminRole } from './types';

/**
 * Les comptes d'accès d'un exploitant.
 *
 * L'API existait depuis le début ; aucun écran ne s'en servait. Un exploitant
 * ne pouvait donc pas donner la console à son vendeur sans lui prêter son
 * propre mot de passe — et le journal enregistrait alors tout sous son nom à
 * lui, ce qui vide le journal de son intérêt.
 */

export interface AdminUserView {
  id: string;
  tenantId: string | null;
  email: string;
  role: AdminRole;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAdminUserInput {
  email: string;
  password: string;
  /** Le serveur refuse tout autre rôle : on ne se clone pas. */
  role: 'OPERATOR' | 'VIEWER';
}

export const adminUsersApi = {
  list: () => api.get<AdminUserView[]>('/admin-users'),
  create: (input: CreateAdminUserInput) => api.post<AdminUserView>('/admin-users', input),
  remove: (id: string) => api.delete<void>(`/admin-users/${id}`),
};
