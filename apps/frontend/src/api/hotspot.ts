import { api } from './client';

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

export interface HotspotCookie {
  id: string;
  username: string;
  macAddress: string;
  expiresInSeconds: number;
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
  overview: () => api.get<HotspotOverview>('/hotspot/overview'),
  walledGarden: () =>
    api.get<{ hosts: WalledGardenEntry[]; ips: WalledGardenIpEntry[] }>('/hotspot/walled-garden'),
  addHost: (input: { dstHost: string; comment?: string }) =>
    api.post<WalledGardenEntry>('/hotspot/walled-garden', input),
  removeHost: (id: string) => api.delete<void>(`/hotspot/walled-garden/${encodeURIComponent(id)}`),
  addIp: (input: { dstAddress: string; comment?: string }) =>
    api.post<WalledGardenIpEntry>('/hotspot/walled-garden/ip', input),
  removeIp: (id: string) => api.delete<void>(`/hotspot/walled-garden/ip/${encodeURIComponent(id)}`),
  cookies: () => api.get<HotspotCookie[]>('/hotspot/cookies'),
  deleteCookie: (id: string) => api.delete<void>(`/hotspot/cookies/${encodeURIComponent(id)}`),
  cutAccess: (username: string) =>
    api.post<{ cookiesRemoved: number; sessionsClosed: number }>(
      `/hotspot/cut-access/${encodeURIComponent(username)}`,
    ),
  sessions: () => api.get<SessionView[]>('/hotspot/sessions'),
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
