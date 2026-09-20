import { api } from './client';

/**
 * PPPoE : l'autre façon de vendre de l'accès.
 *
 * Là où le HotSpot authentifie un navigateur derrière un portail, PPPoE
 * authentifie la connexion elle-même — ce qu'on pose chez un abonné raccordé
 * à demeure, qui n'a pas à ouvrir une page pour être en ligne.
 */

export interface PppSecret {
  id: string;
  username: string;
  disabled: boolean;
  /** Nom du profil, qui porte le débit. `null` signifie `default`. */
  profile: string | null;
  service: string;
  comment: string | null;
  /** Adresse imposée, au lieu du bassin du profil. */
  remoteAddress: string | null;
  limitBytesIn: number | null;
  limitBytesOut: number | null;
  lastLoggedOut: string | null;
}

export interface PppProfile {
  id: string;
  name: string;
  comment: string | null;
  isDefault: boolean;
  localAddress: string | null;
  remoteAddress: string | null;
  dnsServer: string | null;
  rateLimitRxBitsPerSecond: number | null;
  rateLimitTxBitsPerSecond: number | null;
}

/**
 * Une session en cours.
 *
 * **Noms de champs non vérifiés sur matériel** : le parc n'a aucun PPPoE en
 * service, `/ppp/active` était vide au relevé. Si un jour une colonne reste
 * obstinément vide alors qu'un abonné est connecté, c'est ici qu'il faut
 * regarder.
 */
export interface PppActive {
  id: string;
  username: string;
  service: string;
  callerId: string | null;
  address: string | null;
  uptimeSeconds: number;
  bytesIn: number | null;
  bytesOut: number | null;
}

export interface PppoeServer {
  id: string;
  serviceName: string;
  interfaceName: string;
  disabled: boolean;
  defaultProfile: string | null;
  authentication: string[];
  oneSessionPerHost: boolean;
  maxSessions: number | null;
}

export interface IpPool {
  id: string;
  name: string;
  ranges: string;
  total: number | null;
  used: number | null;
  available: number | null;
}

export interface CreatePppSecret {
  username: string;
  password: string;
  profile?: string;
  service?: string;
  remoteAddress?: string;
  comment?: string;
}

/** Le nom n'y est pas : il identifie le compte. */
export type UpdatePppSecret = Partial<Omit<CreatePppSecret, 'username'>>;

const base = (routerId: string) => `/routers/${routerId}/ppp`;

export const pppApi = {
  secrets: (routerId: string) => api.get<PppSecret[]>(`${base(routerId)}/secrets`),
  profiles: (routerId: string) => api.get<PppProfile[]>(`${base(routerId)}/profiles`),
  active: (routerId: string) => api.get<PppActive[]>(`${base(routerId)}/active`),
  servers: (routerId: string) => api.get<PppoeServer[]>(`${base(routerId)}/servers`),
  pools: (routerId: string) => api.get<IpPool[]>(`${base(routerId)}/pools`),

  create: (routerId: string, dto: CreatePppSecret) =>
    api.post<PppSecret>(`${base(routerId)}/secrets`, dto),
  update: (routerId: string, username: string, dto: UpdatePppSecret) =>
    api.patch<PppSecret>(`${base(routerId)}/secrets/${encodeURIComponent(username)}`, dto),
  setDisabled: (routerId: string, username: string, disabled: boolean) =>
    api.patch<PppSecret>(`${base(routerId)}/secrets/${encodeURIComponent(username)}/disabled`, {
      disabled,
    }),
  remove: (routerId: string, username: string) =>
    api.delete<void>(`${base(routerId)}/secrets/${encodeURIComponent(username)}`),
  disconnect: (routerId: string, id: string) =>
    api.delete<void>(`${base(routerId)}/active/${encodeURIComponent(id)}`),
};
