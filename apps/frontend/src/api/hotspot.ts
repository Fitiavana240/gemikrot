import { api } from './client';
import type { Coupure } from './coupure';
import { routerQuery } from '../routers/RouterContext';

export interface HotspotServerProfile {
  id: string;
  name: string;
  dnsName: string | null;
  hotspotAddress: string | null;
  htmlDirectory: string | null;
  /** Moyens d'authentification acceptés : `cookie` contourne RADIUS. */
  loginBy: string[];
  httpCookieLifetimeSeconds: number | null;
  useRadius: boolean;
  radiusAccounting: boolean;
}

export interface HotspotServer {
  id: string;
  name: string;
  interfaceName: string | null;
  addressPool: string | null;
  profileName: string | null;
  idleTimeoutSeconds: number | null;
  addressesPerMac: number | null;
  disabled: boolean;
  profile: HotspotServerProfile | null;
}

export interface HotspotOverview {
  servers: HotspotServer[];
  profiles: HotspotServerProfile[];
  cookieCount: number;
  activeSessionCount: number;
  /** Sessions entrées sans passer par RADIUS — non coupées par une suspension. */
  sessionsWithoutRadius: number;
}

export interface WalledGardenEntry {
  id: string;
  action: 'allow' | 'deny';
  dstHost: string | null;
  dstPort: string | null;
  comment: string | null;
  disabled: boolean;
  hits: number;
}

export interface WalledGardenIpEntry {
  id: string;
  action: 'accept' | 'drop' | 'reject';
  dstAddress: string | null;
  dstPort: string | null;
  protocol: string | null;
  comment: string | null;
  disabled: boolean;
}

/**
 * Le stock de tickets posé sur le routeur.
 *
 * À ne **jamais additionner** avec le compte des tickets de la base : un
 * ticket imprimé et perdu compte ici et pas là, un ticket créé dans
 * l'application pour un autre routeur compte là et pas ici.
 */
export interface StockRouteur {
  total: number;
  /** Comptes actifs jamais connectés : des tickets qui n'ont pas servi. */
  jamaisUtilises: number;
  parProfil: { profil: string; nombre: number }[];
}

export interface HotspotCookie {
  id: string;
  username: string;
  macAddress: string;
  expiresInSeconds: number;
  /**
   * Ce que devient le compte derrière ce cookie.
   *
   * `bloque` et `absent` sont des reliquats : quelqu'un a bloqué ou supprimé
   * le compte et le cookie est resté. Dans une liste d'une cinquantaine de
   * lignes, ils étaient introuvables à l'œil.
   */
  etatDuCompte: 'actif' | 'bloque' | 'absent';
}

export interface SessionView {
  id: string;
  username: string;
  startedAt: string | null;
  endedAt: string | null;
  uptimeSeconds: number;
  bytesIn: number;
  bytesOut: number;
  callingStationId: string | null;
  terminateCause: string | null;
  active: boolean;
}

export const hotspotApi = {
  overview: (routerId?: string) =>
    api.get<HotspotOverview>(`/hotspot/overview${routerQuery(routerId)}`),
  walledGarden: (routerId?: string) =>
    api.get<{ hosts: WalledGardenEntry[]; ips: WalledGardenIpEntry[] }>(
      `/hotspot/walled-garden${routerQuery(routerId)}`,
    ),
  addHost: (input: { dstHost: string; comment?: string }, routerId?: string) =>
    api.post<WalledGardenEntry>(`/hotspot/walled-garden${routerQuery(routerId)}`, input),
  removeHost: (id: string, routerId?: string) =>
    api.delete<void>(`/hotspot/walled-garden/${encodeURIComponent(id)}${routerQuery(routerId)}`),
  addIp: (input: { dstAddress: string; comment?: string }, routerId?: string) =>
    api.post<WalledGardenIpEntry>(`/hotspot/walled-garden/ip${routerQuery(routerId)}`, input),
  removeIp: (id: string, routerId?: string) =>
    api.delete<void>(`/hotspot/walled-garden/ip/${encodeURIComponent(id)}${routerQuery(routerId)}`),
  cookies: (routerId?: string) =>
    api.get<HotspotCookie[]>(`/hotspot/cookies${routerQuery(routerId)}`),
  deleteCookie: (id: string, routerId?: string) =>
    api.delete<void>(`/hotspot/cookies/${encodeURIComponent(id)}${routerQuery(routerId)}`),
  /** Ce que le routeur porte réellement, par opposition à ce que la base suit. */
  stock: (routerId?: string) =>
    api.get<StockRouteur>(`/hotspot/stock${routerQuery(routerId)}`),
  cutAccess: (username: string, routerId?: string) =>
    api.post<Coupure>(
      `/hotspot/cut-access/${encodeURIComponent(username)}${routerQuery(routerId)}`,
    ),
  sessions: (routerId?: string) =>
    api.get<SessionView[]>(`/hotspot/sessions${routerQuery(routerId)}`),
};

export function formatVolume(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} Go`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} Mo`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${bytes} o`;
}

export function formatUptime(seconds: number): string {
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)} j ${Math.floor((seconds % 86_400) / 3600)} h`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min`;
  return `${seconds} s`;
}
