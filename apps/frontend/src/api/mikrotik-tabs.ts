import { api } from './client';

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

export const hotspotTabsApi = {
  users: (routerId?: string) => api.get<HotspotUser[]>(`/hotspot/users${q(routerId)}`),
  profiles: (routerId?: string) => api.get<HotspotProfile[]>(`/hotspot/profiles${q(routerId)}`),
  hosts: (routerId?: string) => api.get<HotspotHost[]>(`/hotspot/hosts${q(routerId)}`),
  ipBindings: (routerId?: string) => api.get<IpBinding[]>(`/hotspot/ip-bindings${q(routerId)}`),
  dhcpLeases: (routerId?: string) => api.get<DhcpLease[]>(`/hotspot/dhcp-leases${q(routerId)}`),
  /** Bloque ou reactive un compte sans le supprimer : l'historique reste. */
  setUserDisabled: (username: string, disabled: boolean, routerId?: string) =>
    api.patch<HotspotUser>(`/hotspot/users/${encodeURIComponent(username)}/disabled${q(routerId)}`, {
      disabled,
    }),
  deleteUser: (username: string, routerId?: string) =>
    api.delete<void>(`/hotspot/users/${encodeURIComponent(username)}${q(routerId)}`),
};

export const umTabsApi = {
  sessions: (routerId?: string, username?: string) =>
    api.get<UmSession[]>(`/user-manager/sessions${q(routerId, { username: username ?? '' })}`),
  assignments: (routerId?: string, username?: string) =>
    api.get<UmAssignment[]>(`/user-manager/assignments${q(routerId, { username: username ?? '' })}`),
};

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
