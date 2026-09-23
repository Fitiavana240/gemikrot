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
  /** L'identifiant public, celui qui se lit dans `/p/<slug>`. */
  slug: string;
  name: string;
  wifiName: string;
  domains: string[];
  logoUrl: string | null;
  /** Numéro WhatsApp d'assistance, chiffres seuls. Vide = pas d'assistance. */
  supportWhatsapp: string | null;
  currency: string;
  status: TenantStatus;
  /** SAS-2 : ce que l'exploitant doit à la plateforme. `null` = rien souscrit. */
  platformPlanName: string | null;
  maxRouters: number | null;
  platformEndsAt: string | null;
  createdAt: string;
  mobileMoneyAccounts?: MobileMoneyAccount[];
}

export interface UpdateTenantInput {
  slug?: string;
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
  /** SAS-2 : où en est l'exploitant de son abonnement à la plateforme. */
  monAbonnement: () => api.get<AbonnementPlateforme>('/tenants/me/abonnement'),
  definirAbonnement: (
    id: string,
    dto: { platformPlanName?: string | null; maxRouters?: number | null; platformEndsAt?: string | null },
  ) => api.patch<AbonnementPlateforme>(`/tenants/${id}/abonnement`, dto),
  /** Le catalogue, lisible de tout compte connecte : la page de blocage s'en sert. */
  offres: () => api.get<CataloguePlateforme>('/tenants/offres'),
  souscrire: (id: string, code: string) =>
    api.post<AbonnementPlateforme>(`/tenants/${id}/abonnement/souscrire`, { code }),
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
    api.post<{ tenantId: string; status: TenantStatus; message: string; essaiJusquAu: string }>(
      '/auth/signup',
      input,
    ),
};

/**
 * L'abonnement d'un exploitant à la plateforme.
 *
 * `ecritureBloquee` ne coupe que la vente. La lecture reste ouverte —
 * fermer la consultation reviendrait à prendre en otage les données de
 * quelqu'un pour une facture — et les clients finaux gardent leur accès,
 * le routeur appliquant seul les validités.
 */
export interface AbonnementPlateforme {
  offre: string | null;
  /** Le code du catalogue, quand le nom enregistre s'y rattache. */
  offreCode: 'ESSAI' | 'MENSUEL' | 'ANNUEL' | null;
  maxRouteurs: number | null;
  routeursUtilises: number;
  echeance: string | null;
  finDeTolerance: string | null;
  etat: 'sans-abonnement' | 'a-jour' | 'en-tolerance' | 'expire';
  joursRestants: number | null;
  ecritureBloquee: boolean;
  /** Ce qu'un renouvellement coute, parc actuel compris. `null` = offre non reconnue. */
  montantDu: number | null;
  prixParRouteur: number | null;
  periode: string | null;
  devise: string;
}

/** Une offre du catalogue de la plateforme. */
export interface OffrePlateforme {
  code: 'ESSAI' | 'MENSUEL' | 'ANNUEL';
  nom: string;
  prixParRouteur: number;
  periodeJours: number;
  periode: string;
  toleranceJours: number;
  maxRouteurs: number | null;
  argument: string;
}

/**
 * A qui l'exploitant s'adresse pour payer. Tout `null` : aucun moyen de
 * contact n'est configure, et la page de blocage le dit franchement plutot
 * que d'afficher un numero mort.
 */
export interface ContactPlateforme {
  telephone: string | null;
  whatsapp: string | null;
  courriel: string | null;
}

export interface CataloguePlateforme {
  offres: OffrePlateforme[];
  contact: ContactPlateforme;
}
