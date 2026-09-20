import { api } from './client';
import type { Customer, Device } from './types';

export interface CreateCustomerInput {
  name: string;
  phone: string;
  email?: string;
  address?: string;
}

export interface RegisterDeviceInput {
  macAddress: string;
  ipAddress?: string;
  hostname?: string;
  deviceType?: string;
}


/**
 * La fiche reunit ce qui etait eclate sur cinq ecrans. Les collections sont
 * bornees cote serveur : une fiche sert a decider, pas a archiver.
 */
export interface CustomerSheet {
  client: Customer;
  tickets: {
    id: string;
    code: string;
    status: string;
    expiresAt: string | null;
    umUsername: string | null;
    plan: { name: string } | null;
  }[];
  abonnements: {
    id: string;
    status: string;
    hotspotUsername: string;
    currentPeriodEnd: string;
    graceEndsAt: string;
    plan: { name: string } | null;
  }[];
  appareils: {
    id: string;
    macAddress: string;
    hostname: string | null;
    type: string;
    bypassEnabled: boolean;
    lastSeenAt: string;
  }[];
  paiements: {
    id: string;
    amount: string;
    currency: string;
    method: string;
    status: string;
    reference: string;
    createdAt: string;
  }[];
}

export const customersApi = {
  list: () => api.get<Customer[]>('/customers'),
  get: (id: string) => api.get<Customer>(`/customers/${id}`),
  fiche: (id: string) => api.get<CustomerSheet>(`/customers/${id}/fiche`),
  create: (input: CreateCustomerInput) => api.post<Customer>('/customers', input),
  /** Corriger un nom ou un numéro sans recréer la fiche. */
  update: (id: string, input: Partial<CreateCustomerInput>) =>
    api.patch<Customer>(`/customers/${id}`, input),
  disable: (id: string) => api.patch<Customer>(`/customers/${id}/disable`),
  enable: (id: string) => api.patch<Customer>(`/customers/${id}/enable`),
  listDevices: (id: string) => api.get<Device[]>(`/customers/${id}/devices`),
  registerDevice: (id: string, input: RegisterDeviceInput) =>
    api.post<Device>(`/customers/${id}/devices`, input),
};
