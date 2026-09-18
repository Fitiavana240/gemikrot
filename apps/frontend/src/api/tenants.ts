import { api } from './client';
import type { PaymentMethod } from './types';

export type TenantStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface MobileMoneyAccount {
  id: string;
  provider: PaymentMethod;
  phoneNumber: string;
  /** Nom du titulaire de la puce, affiché au client qui paie. */
  accountName: string;
  isActive: boolean;
}

export interface Tenant {
  id: string;
  name: string;
  wifiName: string;
  domains: string[];
  logoUrl: string | null;
  currency: string;
  status: TenantStatus;
  createdAt: string;
  mobileMoneyAccounts?: MobileMoneyAccount[];
}

export interface UpdateTenantInput {
  name?: string;
  wifiName?: string;
  domains?: string[];
  logoUrl?: string;
  currency?: string;
}

export interface SignupInput {
  organizationName: string;
  wifiName: string;
  domains?: string[];
  logoUrl?: string;
  currency: string;
  email: string;
  password: string;
  mobileMoneyAccounts?: { provider: PaymentMethod; phoneNumber: string; accountName: string }[];
}

export const tenantsApi = {
  mine: () => api.get<Tenant>('/tenants/me'),
  update: (input: UpdateTenantInput) => api.patch<Tenant>('/tenants/me', input),
  addMobileMoney: (input: Omit<MobileMoneyAccount, 'id' | 'isActive'>) =>
    api.post<MobileMoneyAccount>('/tenants/me/mobile-money', input),
  removeMobileMoney: (id: string) => api.delete<void>(`/tenants/me/mobile-money/${id}`),

  // Réservé au SUPER_ADMIN.
  list: () => api.get<Tenant[]>('/tenants'),
  activate: (id: string) => api.post<Tenant>(`/tenants/${id}/activate`),
  suspend: (id: string) => api.post<Tenant>(`/tenants/${id}/suspend`),
};

export const signupApi = {
  signup: (input: SignupInput) =>
    api.post<{ tenantId: string; status: TenantStatus; message: string }>('/auth/signup', input),
};
