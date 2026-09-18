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

export const mikrotikApi = {
  status: () => api.get<MikrotikStatus>('/mikrotik/status'),
  activeSessions: () => api.get<HotspotActiveUser[]>('/mikrotik/active-sessions'),
  hosts: () => api.get<HotspotHost[]>('/mikrotik/hosts'),
  disconnect: (sessionId: string) => api.post<void>(`/mikrotik/active-sessions/${sessionId}/disconnect`),
};
