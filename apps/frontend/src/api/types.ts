// Miroir des DTOs/entités Prisma exposés par le backend. Les champs Decimal
// et BigInt de Prisma sont sérialisés en string par l'API (voir
// apps/backend/src/main.ts) : on les type `string` ici, pas `number`.

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
export type StartsWhen = 'LOGON' | 'CREATION';
export type PlanStatus = 'ACTIVE' | 'ARCHIVED';
export type CustomerStatus = 'ACTIVE' | 'DISABLED';
export type VoucherStatus = 'CREATED' | 'SOLD' | 'ACTIVE' | 'EXPIRED' | 'DISABLED' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'ORANGE_MONEY' | 'MVOLA' | 'AIRTEL_MONEY' | 'OTHER';
export type PaymentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'CANCELLED' | 'REFUNDED';

export interface AuthUser {
  id: string;
  email: string;
  role: AdminRole;
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceAr: string;
  validityDurationSeconds: number;
  startsWhen: StartsWhen;
  rateLimitRxBps: number | null;
  rateLimitTxBps: number | null;
  transferLimitBytes: string | null;
  maxSharedUsers: number | null;
  mikrotikProfileName: string;
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
  priceAr: string;
  status: VoucherStatus;
  customerId: string | null;
  deviceId: string | null;
  createdAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
}

export interface Payment {
  id: string;
  customerId: string;
  planId: string;
  amountAr: string;
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
  revenueByPlan: { planId: string; _sum: { amountAr: string | null }; _count: { _all: number } }[];
  revenueByMethod: { method: PaymentMethod; _sum: { amountAr: string | null }; _count: { _all: number } }[];
  recentPayments: Payment[];
  recentCustomers: Customer[];
  connectedClients: number;
}
