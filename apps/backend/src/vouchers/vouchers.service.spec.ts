import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma, VoucherStatus } from '@prisma/client';
import { VouchersService } from './vouchers.service.js';
import * as voucherCode from './voucher-code.util.js';

vi.mock('./voucher-code.util.js', () => ({ generateVoucherCode: vi.fn() }));

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function createFakePrisma() {
  const vouchers = new Map<string, any>();
  const plan = {
    id: 'plan-1',
    name: '1Jour-2000Ar',
    priceAr: new Prisma.Decimal(2000),
    status: 'ACTIVE',
    startsWhen: 'LOGON',
    validityDurationSeconds: 86400,
    mikrotikProfileName: '1JOUR-2000AR',
  };

  return {
    plan: { findUnique: vi.fn(async () => plan) },
    router: { findFirst: vi.fn(async () => ({ id: 'router-1' })) },
    voucherBatch: {
      create: vi.fn(async () => ({ id: 'batch-1', jobs: [{ id: 'job-1' }] })),
      update: vi.fn(async () => ({})),
    },
    voucherJob: { update: vi.fn(async () => ({})) },
    voucher: {
      create: vi.fn(async ({ data }: any) => {
        if (vouchers.has(data.code)) throw p2002();
        const record = { id: `v-${vouchers.size}`, status: VoucherStatus.CREATED, ...data };
        vouchers.set(data.code, record);
        return record;
      }),
      findUnique: vi.fn(async ({ where }: any) => vouchers.get(where.code) ?? null),
    },
    _vouchers: vouchers,
  };
}

describe('VouchersService.generateBatch', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let audit: { log: ReturnType<typeof vi.fn> };
  let mikrotik: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    prisma = createFakePrisma();
    audit = { log: vi.fn(async () => {}) };
    mikrotik = {};
    vi.mocked(voucherCode.generateVoucherCode).mockReset();
  });

  it('génère la quantité demandée de vouchers, tous avec un code unique', async () => {
    const codes = ['AAA', 'BBB', 'CCC', 'DDD'];
    vi.mocked(voucherCode.generateVoucherCode).mockImplementation(() => codes.shift()!);

    const service = new VouchersService(prisma as any, audit as any, mikrotik as any);
    const result = await service.generateBatch(
      { planId: 'plan-1', quantity: 4 } as any,
      'admin-1',
    );

    expect(result).toHaveLength(4);
    expect(new Set(result.map((v) => v.code)).size).toBe(4);
  });

  it("relance la génération quand le code aléatoire entre en collision avec un voucher existant", async () => {
    // 'DUP' est généré deux fois de suite avant que 'UNIQUE' ne soit tenté.
    const codes = ['DUP', 'DUP', 'UNIQUE'];
    vi.mocked(voucherCode.generateVoucherCode).mockImplementation(() => codes.shift()!);

    const service = new VouchersService(prisma as any, audit as any, mikrotik as any);
    const first = await (service as any).createVoucherWithUniqueCode({ planId: 'plan-1', priceAr: 2000 });
    expect(first.code).toBe('DUP');

    const second = await (service as any).createVoucherWithUniqueCode({ planId: 'plan-1', priceAr: 2000 });
    expect(second.code).toBe('UNIQUE');
    expect(prisma.voucher.create).toHaveBeenCalledTimes(3);
  });
});
