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
  /** Numéro WhatsApp d'assistance, chiffres seuls. Vide = pas d'assistance. */
  supportWhatsapp: string | null;
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
  supportWhatsapp?: string;
  currency?: string;
}

export interface SignupInput {
  organizationName: string;
  wifiName: string;
  domains?: string[];
  logoUrl?: string;
  supportWhatsapp?: string;
  currency: string;
  email: string;
  password: string;
  mobileMoneyAccounts?: { provider: PaymentMethod; phoneNumber: string; accountName: string }[];
}

/** SAS-3 : les quatre pas d'une mise en route, constatés et non déclarés. */
export interface ÉtapeMiseEnRoute {
  clé: 'routeur' | 'offres' | 'puce' | 'vente';
  titre: string;
  aide: string;
  lien: string;
  fait: boolean;
  /** Ce qu'on a constaté : « 3 offres actives », « aucun routeur ». */
  constat: string;
}

export interface MiseEnRoute {
  étapes: ÉtapeMiseEnRoute[];
  faites: number;
  terminée: boolean;
}

export const tenantsApi = {
  miseEnRoute: () => api.get<MiseEnRoute>('/tenants/me/mise-en-route'),
  mine: () => api.get<Tenant>('/tenants/me'),
  update: (input: UpdateTenantInput) => api.patch<Tenant>('/tenants/me', input),
  addMobileMoney: (input: Omit<MobileMoneyAccount, 'id' | 'isActive'>) =>
    api.post<MobileMoneyAccount>('/tenants/me/mobile-money', input),
  /** Retire la puce du choix propose au client, sans effacer son historique. */
  setMobileMoneyActive: (id: string, isActive: boolean) =>
    api.patch<MobileMoneyAccount>(`/tenants/me/mobile-money/${id}/active`, { isActive }),
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
