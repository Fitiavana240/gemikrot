// Miroir des DTOs/entités Prisma exposés par le backend. Les champs Decimal
// et BigInt de Prisma sont sérialisés en string par l'API (voir
// apps/backend/src/main.ts) : on les type `string` ici, pas `number`.

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
export type StartsWhen = 'FIRST_AUTH' | 'ASSIGNED';
export type PlanStatus = 'ACTIVE' | 'ARCHIVED';
export type CustomerStatus = 'ACTIVE' | 'DISABLED';
export type VoucherStatus = 'CREATED' | 'SOLD' | 'ACTIVE' | 'EXPIRED' | 'DISABLED' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'ORANGE_MONEY' | 'MVOLA' | 'AIRTEL_MONEY' | 'OTHER';
export type PaymentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'CANCELLED' | 'REFUNDED';

export interface AuthUser {
  id: string;
  email: string;
  role: AdminRole;
  /** `null` pour le SUPER_ADMIN, rattaché à aucun exploitant. */
  tenantId: string | null;
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: string;
  validityDurationSeconds: number;
  startsWhen: StartsWhen;
  rateLimitRxBps: number | null;
  rateLimitTxBps: number | null;
  transferLimitBytes: string | null;
  maxSharedUsers: number | null;
  /** Profil de la table **HotSpot**. C'est celui d'où l'offre a été importée. */
  mikrotikProfileName: string;
  /**
   * Profil **User Manager** portant la validité calendaire de l'offre.
   *
   * `null` tant que l'offre n'a pas été synchronisée : le profil est alors
   * créé à la génération, sous un nom dérivé de celui de l'offre. Les deux
   * noms ne coïncident pas toujours — User Manager refuse des caractères que
   * le HotSpot accepte, les espaces notamment.
   */
  umProfileName: string | null;
  status: PlanStatus;
  createdAt: string;
}

export interface Device {
  id: string;
  customerId: string | null;
  macAddress: string;
  ipAddress: string | null;
  hostname: string | null;
  deviceType: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  status: CustomerStatus;
  createdAt: string;
}

export interface Voucher {
  id: string;
  code: string;
  batchId: string | null;
  planId: string;
  price: string;
  status: VoucherStatus;
  customerId: string | null;
  deviceId: string | null;
  createdAt: string;
  activatedAt: string | null;
  /** Échéance calculée par le routeur. `null` = validité pas encore démarrée. */
  expiresAt: string | null;
  /** Compte User Manager. `null` = ticket historique, servi par le HotSpot. */
  umUsername: string | null;
  umState: string | null;
  lastReconciledAt: string | null;
}

export interface Payment {
  id: string;
  customerId: string;
  planId: string;
  amount: string;
  method: PaymentMethod;
  reference: string;
  status: PaymentStatus;
  voucherId: string | null;
  verifiedByAdminId: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface DashboardSummary {
  vouchersByStatus: { status: VoucherStatus; _count: { _all: number } }[];
  revenue: { today: string; thisWeek: string; thisMonth: string };
  revenueByPlan: { planId: string; _sum: { amount: string | null }; _count: { _all: number } }[];
  revenueByMethod: { method: PaymentMethod; _sum: { amount: string | null }; _count: { _all: number } }[];
  recentPayments: Payment[];
  recentCustomers: Customer[];
  connectedClients: number;
  /** Tickets encore vendables : zero veut dire qu'on ne peut plus vendre. */
  ticketsDisponibles: number;
  abonnesActifs: number;
  /** Abonnements arrivant a echeance sous sept jours : a relancer. */
  echeancesProches: number;
  /**
   * Vrai quand les travaux de fond tournent sur le serveur.
   *
   * Faux, rien n'expire tout seul : ni les tickets arrivés à échéance, ni la
   * coupure des accès correspondants, ni la suspension des abonnés hors
   * tolérance. Les écrans continuent pourtant de parler d'échéances.
   */
  ordonnanceurActif: boolean;
  paiementsEnAttente: number;
  /**
   * Date du plus ancien paiement encore en attente, ou `null`.
   *
   * Le compte seul ne dit pas si la file avance : deux paiements déclarés ce
   * matin et deux qui traînent depuis trois jours donnent le même « 2 ».
   */
  paiementEnAttenteDepuis: string | null;
}
