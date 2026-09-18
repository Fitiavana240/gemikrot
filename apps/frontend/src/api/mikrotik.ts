import { api } from './client';

export interface HotspotActiveUser {
  id: string;
  username: string;
  address: string;
  macAddress: string;
  uptimeSeconds: number;
  sessionTimeLeftSeconds: number | null;
  idleTimeSeconds: number;
  bytesIn: number;
  bytesOut: number;
  loginBy: string;
}

export interface HotspotHost {
  id: string;
  macAddress: string;
  address: string;
  toAddress: string | null;
  server: string;
  idleTimeSeconds: number;
  bypassed: boolean;
  authorized: boolean;
}

export interface MikrotikStatus {
  identity: { name: string };
  resource: {
    version: string;
    uptime: string;
    cpuLoadPercent: number;
    freeMemoryBytes: number;
    totalMemoryBytes: number;
    boardName: string;
  };
  ntp: { enabled: boolean; status: string; lastUpdate: string | null };
}

/** Les routes sont portées par un routeur depuis le passage au multi-sites. */
export const mikrotikApi = {
  status: (routerId: string) => api.get<MikrotikStatus>(`/routers/${routerId}/status`),
  activeSessions: (routerId: string) =>
    api.get<HotspotActiveUser[]>(`/routers/${routerId}/active-sessions`),
  hosts: (routerId: string) => api.get<HotspotHost[]>(`/routers/${routerId}/hosts`),
  disconnect: (routerId: string, sessionId: string) =>
    api.post<void>(`/routers/${routerId}/active-sessions/${sessionId}/disconnect`),
};
