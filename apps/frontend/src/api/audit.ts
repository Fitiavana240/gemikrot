import { api } from './client';

/** Une ligne du journal, telle que la console l'affiche. */
export interface AuditEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  result: 'SUCCESS' | 'FAILURE';
  ipAddress: string | null;
  createdAt: string;
  /** Nul si le compte a été supprimé depuis : le journal survit à son auteur. */
  adminUserName: string | null;
  routerLabel: string | null;
  payloadDiff: unknown;
}

export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}

export interface AuditFilter {
  action?: string;
  targetType?: string;
  result?: string;
  since?: string;
  cursor?: string;
}

/**
 * Traduction des actions enregistrées par le code.
 *
 * Une action inconnue s'affiche telle quelle plutôt que d'être masquée : une
 * traduction manquante doit se voir, pas faire disparaître la ligne.
 */
export const ACTION_LABEL: Record<string, string> = {
  LOGIN: 'Connexion',
  LOGIN_FAILED: 'Connexion refusée',
  LOGOUT: 'Déconnexion',
  CREATE_VOUCHER_BATCH: 'Génération de tickets',
  SELL_VOUCHER: 'Vente de ticket',
  REVOKE_VOUCHER: "Coupure d'un ticket",
  CREATE_PAYMENT: 'Paiement enregistré',
  VERIFY_PAYMENT: 'Paiement validé',
  SUSPEND_SUBSCRIPTION: "Suspension d'abonnement",
  RESUME_SUBSCRIPTION: "Reprise d'abonnement",
  RENEW_SUBSCRIPTION: "Renouvellement d'abonnement",
  IMPORT_ROUTER: 'Import depuis le routeur',
  CREATE_ROUTER: 'Routeur ajouté',
  UPDATE_ROUTER: 'Routeur modifié',
  CREATE_PLAN: 'Offre créée',
  UPDATE_PLAN: 'Offre modifiée',
  CUT_ACCESS: "Coupure d'accès",
};

export const auditApi = {
  list: (filter: AuditFilter = {}) => {
    const params = new URLSearchParams();
    for (const [clé, valeur] of Object.entries(filter)) {
      if (valeur) params.set(clé, valeur);
    }
    const query = params.toString();
    return api.get<AuditPage>(`/audit${query ? `?${query}` : ''}`);
  },
  facets: () => api.get<{ actions: string[]; targetTypes: string[] }>('/audit/facets'),
};
