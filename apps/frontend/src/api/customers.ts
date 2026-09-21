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

/**
 * Le routeur ne stocke aucun numéro de téléphone. L'import écrit donc un
 * identifiant provisoire de la forme `import:<compte>`, faute de mieux —
 * mais l'afficher tel quel le fait passer pour un vrai numéro, et personne
 * ne pense à le corriger.
 */
export function telephoneAffiche(phone: string | null | undefined): {
  texte: string;
  provisoire: boolean;
} {
  if (!phone) return { texte: '—', provisoire: false };
  if (phone.startsWith('import:')) return { texte: 'à renseigner', provisoire: true };
  return { texte: phone, provisoire: false };
}

/**
 * Le numéro ramené à sa forme nationale : neuf chiffres, sans indicatif.
 *
 * Le même numéro s'écrit `+261 34 03 941 88`, `0340394188` ou `261340394188`
 * selon qui l'a tapé. Même règle que la normalisation du serveur — deux
 * normalisations divergentes donneraient des liens qui ouvrent la discussion
 * de quelqu'un d'autre, ce qui est bien pire que pas de lien du tout.
 */
function nationalise(brut: string): string {
  const chiffres = brut.replace(/\D/g, '');
  if (!chiffres) return '';
  return chiffres.replace(/^00261/, '').replace(/^261/, '').replace(/^0/, '');
}

/**
 * Lien WhatsApp vers ce client, ou `null`.
 *
 * `null` dès que le numéro n'est pas exploitable — provisoire écrit par
 * l'import, vide, ou d'une longueur invraisemblable. Un lien approximatif
 * ouvrirait la discussion d'un inconnu avec un message nominatif : mieux vaut
 * pas de bouton qu'un bouton qui se trompe de personne.
 *
 * `261` est ajouté parce que ce produit vend à Madagascar et que la forme
 * nationale n'en porte pas ; `wa.me` exige l'indicatif.
 */
export function lienWhatsapp(phone: string | null | undefined, message: string): string | null {
  if (!phone || phone.startsWith('import:')) return null;
  const national = nationalise(phone);
  if (!/^[0-9]{9}$/.test(national)) return null;
  return `https://wa.me/261${national}?text=${encodeURIComponent(message)}`;
}

export const customersApi = {
  list: () => api.get<Customer[]>('/customers'),
  get: (id: string) => api.get<Customer>(`/customers/${id}`),
  fiche: (id: string) => api.get<CustomerSheet>(`/customers/${id}/fiche`),
  consommation: (id: string, routerId?: string) =>
    api.get<Consommation>(
      `/customers/${id}/consommation${routerId ? `?routerId=${routerId}` : ''}`,
    ),
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

/**
 * Ce qu'un client a réellement consommé, depuis la comptabilité RADIUS.
 *
 * Deux sources. Les compteurs du compte sont cumulés depuis sa création et
 * ne s'effacent jamais : c'est le total juste. Le journal RADIUS donne le
 * détail — quand, combien de fois — mais le routeur en efface les plus
 * anciennes. `partiel` dit si une ligne repose sur ce seul journal, auquel
 * cas le total est un plancher.
 */
export interface Consommation {
  comptes: number;
  sessions: number;
  dureeSecondes: number;
  octetsRecus: number;
  octetsEnvoyes: number;
  premiere: string | null;
  derniere: string | null;
  partiel: boolean;
  parCompte: {
    compte: string;
    origine: 'ticket' | 'abonnement';
    /** `compteur` = total juste ; `sessions` = plancher ; `aucune` = rien lu. */
    source: 'compteur' | 'sessions' | 'aucune';
    sessions: number;
    dureeSecondes: number;
    octetsRecus: number;
    octetsEnvoyes: number;
    premiere: string | null;
    derniere: string | null;
  }[];
  sessionsDansLeJournal: number;
}
