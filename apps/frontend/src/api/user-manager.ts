import { api } from './client';
import type { Coupure } from './coupure';
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
  /**
   * Attributions désignant un compte disparu du routeur.
   *
   * Elles étaient comptées comme des comptes : un profil annonçait « 16 »
   * pour seize fantômes. Dites à part, jamais additionnées.
   */
  attributionsOrphelines: number;
}

export interface UserManagerLimitation {
  id: string;
  name: string;
  rateLimit: { rxBitsPerSecond: number | null; txBitsPerSecond: number | null };
  /** Volume total, descendant et montant confondus. */
  transferLimitBytes: number | null;
  /**
   * Quotas séparés par sens, distincts du total.
   *
   * Un forfait peut laisser télécharger largement et brider l'envoi — la voie
   * montante est la ressource rare d'un réseau de quartier. Ne montrer que le
   * total ferait croire qu'une seule borne existe.
   */
  downloadLimitBytes: number | null;
  uploadLimitBytes: number | null;
  uptimeLimitSeconds: number | null;
  /**
   * Période au bout de laquelle les compteurs repartent à zéro.
   *
   * `null` veut dire que le quota est **définitif** : c'est la différence
   * entre « 10 Go » et « 10 Go par mois », et rien ne la disait.
   */
  resetCountersIntervalSeconds: number | null;
  /** Date à partir de laquelle les périodes se comptent. */
  resetCountersStartTime: string | null;
  profileNames: string[];
  rateLimitMin: { rxBitsPerSecond: number | null; txBitsPerSecond: number | null };
  rateLimitPriority: number | null;
  rateLimitBurst: { rxBitsPerSecond: number | null; txBitsPerSecond: number | null };
  rateLimitBurstThreshold: { rxBitsPerSecond: number | null; txBitsPerSecond: number | null };
  rateLimitBurstTimeSeconds: { rx: number | null; tx: number | null };
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
  /**
   * Le nom que le client verra, s'il diffère du nom interne.
   *
   * « Name For Users » dans WinBox. Vide, le routeur reprend le nom du
   * profil : `2Heure-500Ar` s'affiche alors tel quel au client.
   */
  nameForUsers?: string;
  comment?: string;
}

export interface CreateLimitationInput {
  name: string;
  /** Débit garanti : servi d'abord, avant que le reste ne soit distribué. */
  rateLimitMinRxBitsPerSecond?: number | null;
  rateLimitMinTxBitsPerSecond?: number | null;
  /** 0 = le plus prioritaire quand le lien sature. */
  rateLimitPriority?: number | null;
  /** Pointe au-dessus du plafond ; sans durée elle ne s'applique jamais. */
  rateLimitBurstRxBitsPerSecond?: number | null;
  rateLimitBurstTxBitsPerSecond?: number | null;
  rateLimitBurstThresholdRxBitsPerSecond?: number | null;
  rateLimitBurstThresholdTxBitsPerSecond?: number | null;
  rateLimitBurstTimeRxSeconds?: number | null;
  rateLimitBurstTimeTxSeconds?: number | null;
  rateLimitRxBitsPerSecond?: number | null;
  rateLimitTxBitsPerSecond?: number | null;
  transferLimitBytes?: number | null;
  downloadLimitBytes?: number | null;
  uploadLimitBytes?: number | null;
  uptimeLimitSeconds?: number | null;
  resetCountersIntervalSeconds?: number | null;
  resetCountersStartTime?: string | null;
}

export interface CreateAccountInput {
  username: string;
  password: string;
  profileName?: string;
  sharedUsers?: number;
  comment?: string;
}

/**
 * Les modifications.
 *
 * Aucune ne porte le nom : sur RouterOS, le nom **est** l'identifiant. Le
 * changer reviendrait à créer un autre objet en abandonnant le premier —
 * avec, pour un compte, tout son historique de sessions.
 *
 * Tout y est facultatif, et seuls les champs envoyés sont écrits : un
 * formulaire qui renverrait l'objet entier écraserait ce qu'un autre a réglé
 * entre-temps.
 */
export type UpdateProfileInput = Partial<Omit<CreateProfileInput, 'name'>>;
export type UpdateLimitationInput = Partial<Omit<CreateLimitationInput, 'name'>>;
export type UpdateAccountInput = Partial<Omit<CreateAccountInput, 'username'>>;

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
  updateProfile: (name: string, input: UpdateProfileInput, routerId?: string) =>
    api.patch<UserManagerProfile>(
      `/user-manager/profiles/${encodeURIComponent(name)}${routerQuery(routerId)}`,
      input,
    ),
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
  updateLimitation: (name: string, input: UpdateLimitationInput, routerId?: string) =>
    api.patch<UserManagerLimitation>(
      `/user-manager/limitations/${encodeURIComponent(name)}${routerQuery(routerId)}`,
      input,
    ),
  deleteLimitation: (name: string, routerId?: string) =>
    api.delete<void>(
      `/user-manager/limitations/${encodeURIComponent(name)}${routerQuery(routerId)}`,
    ),

  listAccounts: (routerId?: string) =>
    api.get<UserManagerAccount[]>(`/user-manager/users${routerQuery(routerId)}`),
  createAccount: (input: CreateAccountInput, routerId?: string) =>
    api.post<UserManagerAccount>(`/user-manager/users${routerQuery(routerId)}`, input),
  updateAccount: (username: string, input: UpdateAccountInput, routerId?: string) =>
    api.patch<UserManagerAccount>(
      `/user-manager/users/${encodeURIComponent(username)}${routerQuery(routerId)}`,
      input,
    ),
  setAccountDisabled: (username: string, disabled: boolean, routerId?: string) =>
    api.patch<UserManagerAccount & { coupure: Coupure | null }>(
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
  /**
   * Retire l'attribution d'un profil à un compte.
   *
   * Ce n'est pas la même chose que supprimer le compte : il reste, sans
   * forfait, donc sans validité — il peut recevoir une nouvelle attribution.
   */
  removeAssignment: (username: string, profileName: string, routerId?: string) =>
    api.delete<void>(
      `/user-manager/users/${encodeURIComponent(username)}/profiles/${encodeURIComponent(profileName)}${routerQuery(routerId)}`,
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
