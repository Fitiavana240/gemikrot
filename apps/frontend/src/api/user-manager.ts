import { api } from './client';
import { routerQuery } from '../routers/RouterContext';

export type ProfileStartsWhen = 'first-auth' | 'assigned';
export type AccountSource = 'TICKET' | 'ABONNEMENT' | 'HORS_APPLICATION';
export type AccountState = 'running-active' | 'used' | 'waiting' | 'unknown';

export interface UserManagerProfile {
  id: string;
  name: string;
  nameForUsers: string | null;
  comment: string | null;
  validityDurationSeconds: number | null;
  startsWhen: ProfileStartsWhen;
  price: number;
  overrideSharedUsers: number | null;
  /** Offre correspondante, quand ce profil est piloté par l'application. */
  planId: string | null;
  planName: string | null;
  limitationNames: string[];
  accountCount: number;
}

export interface UserManagerLimitation {
  id: string;
  name: string;
  rateLimit: { rxBitsPerSecond: number | null; txBitsPerSecond: number | null };
  transferLimitBytes: number | null;
  uptimeLimitSeconds: number | null;
  profileNames: string[];
}

export interface UserManagerAccount {
  username: string;
  disabled: boolean;
  sharedUsers: number;
  comment: string | null;
  profileName: string | null;
  /** Instant absolu (ISO) : le backend a converti le fuseau du routeur. */
  endTime: string | null;
  state: AccountState | null;
  /** Nombre d'attributions du compte : un rachat en ajoute une. */
  assignmentCount: number;
  source: AccountSource;
  customerName: string | null;
  voucherId: string | null;
  subscriptionId: string | null;
}

export interface CreateProfileInput {
  name: string;
  validityDurationSeconds: number | null;
  startsWhen: ProfileStartsWhen;
  price?: number;
  sharedUsers?: number;
}

export interface CreateLimitationInput {
  name: string;
  rateLimitRxBitsPerSecond?: number | null;
  rateLimitTxBitsPerSecond?: number | null;
  transferLimitBytes?: number | null;
  uptimeLimitSeconds?: number | null;
}

export interface CreateAccountInput {
  username: string;
  password: string;
  profileName?: string;
  sharedUsers?: number;
  comment?: string;
}

/**
 * Chaque appel porte le routeur visé. Sans lui le backend retombe sur « le
 * plus ancien routeur enregistré » : correct avec un seul routeur, faux dès
 * qu'un exploitant en gère deux.
 */
export const userManagerApi = {
  listProfiles: (routerId?: string) =>
    api.get<UserManagerProfile[]>(`/user-manager/profiles${routerQuery(routerId)}`),
  createProfile: (input: CreateProfileInput, routerId?: string) =>
    api.post<UserManagerProfile>(`/user-manager/profiles${routerQuery(routerId)}`, input),
  deleteProfile: (name: string, routerId?: string) =>
    api.delete<void>(`/user-manager/profiles/${encodeURIComponent(name)}${routerQuery(routerId)}`),
  attachLimitation: (profileName: string, limitationName: string, routerId?: string) =>
    api.post<void>(
      `/user-manager/profiles/${encodeURIComponent(profileName)}/limitations${routerQuery(routerId)}`,
      { limitationName },
    ),
  detachLimitation: (profileName: string, limitationName: string, routerId?: string) =>
    api.delete<void>(
      `/user-manager/profiles/${encodeURIComponent(profileName)}/limitations/${encodeURIComponent(limitationName)}${routerQuery(routerId)}`,
    ),

  listLimitations: (routerId?: string) =>
    api.get<UserManagerLimitation[]>(`/user-manager/limitations${routerQuery(routerId)}`),
  createLimitation: (input: CreateLimitationInput, routerId?: string) =>
    api.post<UserManagerLimitation>(`/user-manager/limitations${routerQuery(routerId)}`, input),
  deleteLimitation: (name: string, routerId?: string) =>
    api.delete<void>(
      `/user-manager/limitations/${encodeURIComponent(name)}${routerQuery(routerId)}`,
    ),

  listAccounts: (routerId?: string) =>
    api.get<UserManagerAccount[]>(`/user-manager/users${routerQuery(routerId)}`),
  createAccount: (input: CreateAccountInput, routerId?: string) =>
    api.post<UserManagerAccount>(`/user-manager/users${routerQuery(routerId)}`, input),
  setAccountDisabled: (username: string, disabled: boolean, routerId?: string) =>
    api.patch<UserManagerAccount>(
      `/user-manager/users/${encodeURIComponent(username)}/disabled${routerQuery(routerId)}`,
      { disabled },
    ),
  deleteAccount: (username: string, routerId?: string) =>
    api.delete<void>(`/user-manager/users/${encodeURIComponent(username)}${routerQuery(routerId)}`),
  assignProfile: (username: string, profileName: string, routerId?: string) =>
    api.post<void>(
      `/user-manager/users/${encodeURIComponent(username)}/profiles${routerQuery(routerId)}`,
      { profileName },
    ),
};

/** Durée RouterOS en clair : « 30 j », « 2 h », « 45 min ». */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return 'illimitée';
  if (seconds >= 86_400) {
    const days = seconds / 86_400;
    return `${Number.isInteger(days) ? days : days.toFixed(1)} j`;
  }
  if (seconds >= 3600) {
    const hours = seconds / 3600;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  }
  return `${Math.round(seconds / 60)} min`;
}

/** Débit en clair : « 10 Mb/s ». `null` = aucun plafond. */
export function formatRate(bitsPerSecond: number | null): string {
  if (bitsPerSecond == null) return '—';
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(0)} Mb/s`;
  if (bitsPerSecond >= 1000) return `${(bitsPerSecond / 1000).toFixed(0)} kb/s`;
  return `${bitsPerSecond} b/s`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} Go`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} Mo`;
  return `${(bytes / 1024).toFixed(0)} Ko`;
}
