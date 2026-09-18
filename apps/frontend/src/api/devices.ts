import { api } from './client';

export type DeviceType = 'PHONE' | 'COMPUTER' | 'TV' | 'CAMERA' | 'ROUTER' | 'OTHER';

export interface Device {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  routerId: string | null;
  macAddress: string;
  ipAddress: string | null;
  hostname: string | null;
  type: DeviceType;
  detectedType: DeviceType | null;
  detectionSource: string | null;
  bypassEnabled: boolean;
  mikrotikBindingId: string | null;
  lastSeenAt: string;
}

export interface DiscoveredDevice {
  macAddress: string;
  ipAddress: string | null;
  hostname: string | null;
  known: boolean;
  bypassEnabled: boolean;
  suggestedType: DeviceType;
  detectionSource: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface RegisterDeviceInput {
  macAddress: string;
  type: DeviceType;
  customerId?: string;
  subscriptionId?: string;
  ipAddress?: string;
  hostname?: string;
}

export const devicesApi = {
  list: () => api.get<Device[]>('/devices'),
  discover: (routerId?: string) =>
    api.get<DiscoveredDevice[]>(`/devices/discover${routerId ? `?routerId=${routerId}` : ''}`),
  register: (input: RegisterDeviceInput) => api.post<Device>('/devices', input),
  enableBypass: (id: string) => api.post<Device>(`/devices/${id}/bypass`, {}),
  block: (id: string) => api.post<Device>(`/devices/${id}/block`),
};
