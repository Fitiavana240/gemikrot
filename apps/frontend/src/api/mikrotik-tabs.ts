import { api } from './client';
import type { Coupure } from './coupure';

/** Ajoute `?routerId=` quand un routeur est sélectionné. */
function q(routerId: string | undefined, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (routerId) params.set('routerId', routerId);
  for (const [clé, valeur] of Object.entries(extra ?? {})) {
    if (valeur) params.set(clé, valeur);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Un compte de la table HotSpot du routeur.
 *
 * Distinct d'un compte User Manager : le HotSpot tient la sienne, et c'est
 * elle que WinBox montre sous « Users ». Sur ce parc, les comptes historiques
 * vivent ici ; les tickets vendus depuis sont passés à User Manager, seul
 * capable de faire expirer une validité calendaire.
 */
export interface HotspotUser {
  id: string;
  username: string;
  profile: string;
  disabled: boolean;
  /** Sur ce parc, le commentaire porte le nom de la personne. */
  comment: string | null;
  server: string | null;
  bytesIn: number;
  bytesOut: number;
  /** Temps deja consomme, cumule sur toutes les sessions du compte. */
  uptimeSeconds: number;
  /** Plafond, absent du routeur tant qu'il n'est pas pose : `null`, pas zero. */
  limitUptimeSeconds: number | null;
  limitBytesIn: number | null;
  limitBytesOut: number | null;
}

/**
 * Création d'un compte HotSpot.
 *
 * Ce n'est pas un ticket User Manager. Ici le plafond porte sur le **temps
 * passé connecté** : il ne s'écoule pas pendant que le client est
 * déconnecté, là où la validité d'un forfait User Manager est calendaire.
 * C'est ce que portent les tickets « 2h » du parc.
 *
 * Les champs que WinBox propose et que personne n'utilise ici — adresse MAC,
 * adresse fixe, courriel, routes, secret OTP — ne sont volontairement pas
 * exposés : sur les 646 comptes du parc, aucun n'en porte.
 */
export interface CreateHotspotUser {
  username: string;
  password: string;
  profileName: string;
  server?: string;
  comment?: string;
  limitUptimeSeconds?: number | null;
}

/** Le nom identifie le compte : il n'est pas modifiable. */
export type UpdateHotspotUser = Partial<Omit<CreateHotspotUser, 'username'>>;

export interface HotspotProfile {
  id: string;
  name: string;
  rateLimitRxBitsPerSecond: number | null;
  rateLimitTxBitsPerSecond: number | null;
  sessionTimeoutSeconds: number | null;
  sharedUsers: number;
}

/** Un appareil vu par le HotSpot, authentifié ou non. */
export interface HotspotHost {
  id: string;
  macAddress: string;
  address: string | null;
  toAddress: string | null;
  server: string | null;
  idleTime: string | null;
  authorized?: boolean;
  bypassed?: boolean;
}

export interface IpBinding {
  id: string;
  macAddress: string;
  address: string | null;
  toAddress: string | null;
  type: string;
  server: string | null;
  comment: string | null;
  disabled?: boolean;
}

export interface DhcpLease {
  id: string;
  macAddress: string;
  address: string;
  hostName: string | null;
  status: string;
  comment: string | null;
}

/** Une authentification vue par RADIUS. Une entrée par cookie n'y figure pas. */
export interface UmSession {
  id: string;
  username: string;
  nasIpAddress: string | null;
  callingStationId: string | null;
  startTime: string | null;
  endTime: string | null;
  uptimeSeconds: number | null;
  active: boolean;
}

/** L'attribution profil/compte : c'est ici que vit l'échéance réelle. */
export interface UmAssignment {
  id: string;
  username: string;
  profileName: string;
  endTime: string | null;
  state: string;
}

/** Octets -> « 24,4 Gio ». Les multiples de 1024, comme RouterOS les compte. */
export function formatOctets(octets: number): string {
  if (!octets) return '—';
  const unites = ['o', 'Kio', 'Mio', 'Gio', 'Tio'];
  let valeur = octets;
  let rang = 0;
  while (valeur >= 1024 && rang < unites.length - 1) {
    valeur /= 1024;
    rang += 1;
  }
  return `${valeur.toFixed(rang === 0 ? 0 : 1)} ${unites[rang]}`;
}

/** Un client RADIUS declare. Le secret partage ne sort jamais du serveur. */
export interface UmRouter {
  id: string;
  name: string;
  address: string;
  protocol: string;
  coaPort: number | null;
  disabled: boolean;
  /** Seule la presence du secret est exposee, jamais sa valeur. */
  hasSharedSecret: boolean;
}

export interface UmUserGroup {
  id: string;
  name: string;
  outerAuths: string[];
  innerAuths: string[];
  attributes: string | null;
  isDefault: boolean;
}

export interface UmAttribute {
  id: string;
  name: string;
  standardName: string | null;
  typeId: number | null;
  valueType: string | null;
  vendorId: string | null;
  packetTypes: string[];
  isDefault: boolean;
}

export interface HotspotServerProfile {
  id: string;
  name: string;
  /** Methodes acceptees. `cookie` est la porte par laquelle un acces coupe revit. */
  loginBy: string[];
  httpCookieLifetimeSeconds: number | null;
  useRadius: boolean;
  dnsName: string | null;
  hotspotAddress: string | null;
}

export interface HotspotServicePort {
  id: string;
  name: string;
  ports: string;
  disabled: boolean;
}

export const hotspotTabsApi = {
  users: (routerId?: string) => api.get<HotspotUser[]>(`/hotspot/users${q(routerId)}`),
  profiles: (routerId?: string) => api.get<HotspotProfile[]>(`/hotspot/profiles${q(routerId)}`),
  hosts: (routerId?: string) => api.get<HotspotHost[]>(`/hotspot/hosts${q(routerId)}`),
  ipBindings: (routerId?: string) => api.get<IpBinding[]>(`/hotspot/ip-bindings${q(routerId)}`),
  serverProfiles: (routerId?: string) =>
    api.get<HotspotServerProfile[]>(`/hotspot/server-profiles${q(routerId)}`),
  servicePorts: (routerId?: string) =>
    api.get<HotspotServicePort[]>(`/hotspot/service-ports${q(routerId)}`),
  dhcpLeases: (routerId?: string) => api.get<DhcpLease[]>(`/hotspot/dhcp-leases${q(routerId)}`),
  /** Bloque ou reactive un compte sans le supprimer : l'historique reste. */
  setUserDisabled: (username: string, disabled: boolean, routerId?: string) =>
    api.patch<HotspotUser & { coupure: Coupure | null }>(
      `/hotspot/users/${encodeURIComponent(username)}/disabled${q(routerId)}`,
      { disabled },
    ),
  deleteUser: (username: string, routerId?: string) =>
    api.delete<void>(`/hotspot/users/${encodeURIComponent(username)}${q(routerId)}`),
  createUser: (dto: CreateHotspotUser, routerId?: string) =>
    api.post<HotspotUser>(`/hotspot/users${q(routerId)}`, dto),
  updateUser: (username: string, dto: UpdateHotspotUser, routerId?: string) =>
    api.patch<HotspotUser>(`/hotspot/users/${encodeURIComponent(username)}${q(routerId)}`, dto),
};

export const umTabsApi = {
  routers: (routerId?: string) => api.get<UmRouter[]>(`/user-manager/routers${q(routerId)}`),
  userGroups: (routerId?: string) =>
    api.get<UmUserGroup[]>(`/user-manager/user-groups${q(routerId)}`),
  attributes: (routerId?: string) =>
    api.get<UmAttribute[]>(`/user-manager/attributes${q(routerId)}`),
  sessions: (routerId?: string, username?: string) =>
    api.get<UmSession[]>(`/user-manager/sessions${q(routerId, { username: username ?? '' })}`),
  assignments: (routerId?: string, username?: string) =>
    api.get<UmAssignment[]>(`/user-manager/assignments${q(routerId, { username: username ?? '' })}`),
  payments: (routerId?: string) => api.get<UmPayment[]>(`/user-manager/payments${q(routerId)}`),
};

/**
 * Un paiement noté par le routeur — `/user-manager/payment`.
 *
 * **Noms de champs non vérifiés sur matériel** : la collection répond mais
 * elle est vide sur le parc, qui encaisse par Mobile Money hors du routeur.
 * Ces champs viennent des colonnes de WinBox, pas d'un relevé.
 */
export interface UmPayment {
  id: string;
  username: string;
  profileName: string | null;
  price: string | null;
  currency: string | null;
  transactionStart: string | null;
  transactionEnd: string | null;
  transactionStatus: string | null;
}

/** bits/s → « 6 Mb/s », ou un tiret quand il n'y a pas de limite. */
export function formatDebit(bits: number | null): string {
  if (bits == null || bits === 0) return '—';
  if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(bits % 1_000_000 === 0 ? 0 : 1)} Mb/s`;
  if (bits >= 1_000) return `${Math.round(bits / 1_000)} kb/s`;
  return `${bits} b/s`;
}

/** Secondes → « 2 h 30 », ou un tiret. */
export function formatDuree(secondes: number | null): string {
  if (secondes == null || secondes === 0) return '—';
  const j = Math.floor(secondes / 86400);
  const h = Math.floor((secondes % 86400) / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  if (j > 0) return `${j} j ${h} h`;
  if (h > 0) return `${h} h ${m.toString().padStart(2, '0')}`;
  return `${m} min`;
}
