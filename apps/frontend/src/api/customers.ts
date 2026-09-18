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

export const customersApi = {
  list: () => api.get<Customer[]>('/customers'),
  get: (id: string) => api.get<Customer>(`/customers/${id}`),
  create: (input: CreateCustomerInput) => api.post<Customer>('/customers', input),
  disable: (id: string) => api.patch<Customer>(`/customers/${id}/disable`),
  enable: (id: string) => api.patch<Customer>(`/customers/${id}/enable`),
  listDevices: (id: string) => api.get<Device[]>(`/customers/${id}/devices`),
  registerDevice: (id: string, input: RegisterDeviceInput) =>
    api.post<Device>(`/customers/${id}/devices`, input),
};
