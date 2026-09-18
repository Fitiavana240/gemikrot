import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PaymentsService } from './payments.service.js';

const tenantContext = { requireTenantId: () => 'tenant-1', get: () => ({ tenantId: 'tenant-1', isSuperAdmin: false }) };

function createFakePrisma() {
  const payments = new Map<string, any>();

  const client: any = {
    tenant: { findUniqueOrThrow: vi.fn(async () => ({ currency: 'MGA' })) },
    customer: { findUnique: vi.fn(async () => ({ id: 'customer-1' })) },
    plan: { findUnique: vi.fn(async () => ({ id: 'plan-1' })) },
    payment: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return payments.get(where.id) ?? null;
        return null;
      }),
      findFirst: vi.fn(async ({ where }: any) =>
        [...payments.values()].find(
          (p) => p.method === where.method && p.reference === where.reference,
        ) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        const record = {
          id: `pay-${payments.size + 1}`,
          status: PaymentStatus.PENDING,
          ...data,
        };
        payments.set(record.id, record);
        return record;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const record = payments.get(where.id);
        if (!record || record.status !== where.status) return { count: 0 };
        Object.assign(record, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const record = payments.get(where.id);
        Object.assign(record, data);
        return record;
      }),
    },
    _payments: payments,
  };
  // `scoped` renvoie le même faux client : le cloisonnement a son propre test.
  client.scoped = client;
  return client;
}

describe('PaymentsService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let audit: { log: ReturnType<typeof vi.fn> };
  let vouchers: Record<string, ReturnType<typeof vi.fn>>;
  let subscriptions: Record<string, ReturnType<typeof vi.fn>>;
  let provider: { verify: ReturnType<typeof vi.fn> };
  let service: PaymentsService;

  beforeEach(() => {
    prisma = createFakePrisma();
    audit = { log: vi.fn(async () => {}) };
    vouchers = {
      findAvailableForPlan: vi.fn(async () => null),
      generateSingle: vi.fn(async () => ({ id: 'voucher-1', code: 'ABCDE12345' })),
      activate: vi.fn(async () => ({ id: 'voucher-1', code: 'ABCDE12345' })),
    };
    subscriptions = { renew: vi.fn(async () => ({ id: 'sub-1' })) };
    provider = { verify: vi.fn(async () => ({ verified: true })) };
    service = new PaymentsService(
      prisma as any,
      audit as any,
      vouchers as any,
      subscriptions as any,
      provider as any,
      tenantContext as any,
    );
  });

  it('refuse un second paiement avec la même (method, reference) — idempotence Section 24', async () => {
    await service.create({
      customerId: 'customer-1',
      planId: 'plan-1',
      amount: 2000,
      method: 'MVOLA',
      reference: 'REF-001',
    } as any);

    await expect(
      service.create({
        customerId: 'customer-1',
        planId: 'plan-1',
        amount: 2000,
        method: 'MVOLA',
        reference: 'REF-001',
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('attribue un voucher à la vérification et refuse toute nouvelle vérification du même paiement', async () => {
    const payment = await service.create({
      customerId: 'customer-1',
      planId: 'plan-1',
      amount: 2000,
      method: 'CASH',
      reference: 'REF-002',
    } as any);

    const verified = await service.verifyPayment(payment.id, 'admin-1');
    expect(verified.status).toBe(PaymentStatus.VERIFIED);
    expect(vouchers.activate).toHaveBeenCalledTimes(1);

    await expect(service.verifyPayment(payment.id, 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    // Un seul voucher n'a jamais été activé deux fois pour ce paiement.
    expect(vouchers.activate).toHaveBeenCalledTimes(1);
  });

  it("renouvelle l'abonnement au lieu d'attribuer un voucher, une seule fois", async () => {
    const payment = await service.create({
      customerId: 'customer-1',
      planId: 'plan-1',
      subscriptionId: 'sub-1',
      amount: 15000,
      method: 'MVOLA',
      reference: 'REF-ABO-001',
    } as any);

    const verified = await service.verifyPayment(payment.id, 'admin-1');
    expect(verified.status).toBe(PaymentStatus.VERIFIED);
    expect(subscriptions.renew).toHaveBeenCalledTimes(1);
    expect(vouchers.activate).not.toHaveBeenCalled();

    // Rejouer la vérification ne doit jamais prolonger une seconde période.
    await expect(service.verifyPayment(payment.id, 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(subscriptions.renew).toHaveBeenCalledTimes(1);
  });
});
