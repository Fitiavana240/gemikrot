import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PaymentsService } from './payments.service.js';

function createFakePrisma() {
  const payments = new Map<string, any>();

  return {
    customer: { findUnique: vi.fn(async () => ({ id: 'customer-1' })) },
    plan: { findUnique: vi.fn(async () => ({ id: 'plan-1' })) },
    payment: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return payments.get(where.id) ?? null;
        if (where.method_reference) {
          return (
            [...payments.values()].find(
              (p) =>
                p.method === where.method_reference.method &&
                p.reference === where.method_reference.reference,
            ) ?? null
          );
        }
        return null;
      }),
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
}

describe('PaymentsService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let audit: { log: ReturnType<typeof vi.fn> };
  let vouchers: Record<string, ReturnType<typeof vi.fn>>;
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
    provider = { verify: vi.fn(async () => ({ verified: true })) };
    service = new PaymentsService(prisma as any, audit as any, vouchers as any, provider as any);
  });

  it('refuse un second paiement avec la même (method, reference) — idempotence Section 24', async () => {
    await service.create({
      customerId: 'customer-1',
      planId: 'plan-1',
      amountAr: 2000,
      method: 'MVOLA',
      reference: 'REF-001',
    } as any);

    await expect(
      service.create({
        customerId: 'customer-1',
        planId: 'plan-1',
        amountAr: 2000,
        method: 'MVOLA',
        reference: 'REF-001',
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('attribue un voucher à la vérification et refuse toute nouvelle vérification du même paiement', async () => {
    const payment = await service.create({
      customerId: 'customer-1',
      planId: 'plan-1',
      amountAr: 2000,
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
});
