import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma, VoucherStatus } from '@prisma/client';
import { VouchersService } from './vouchers.service.js';
import * as voucherCode from './voucher-code.util.js';

const tenantContext = { requireTenantId: () => 'tenant-1', get: () => ({ tenantId: 'tenant-1', isSuperAdmin: false }) };

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

  const client: any = {
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
      update: vi.fn(async ({ where, data }: any) => {
        const record = [...vouchers.values()].find((v) => v.id === where.id);
        return Object.assign(record ?? {}, data);
      }),
    },
    _vouchers: vouchers,
  };
  // `scoped` renvoie le même faux client : le cloisonnement a son propre test.
  client.scoped = client;
  return client;
}

describe('VouchersService.generateBatch', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let audit: { log: ReturnType<typeof vi.fn> };
  let mikrotik: Record<string, ReturnType<typeof vi.fn>>;
  let clients: Record<string, ReturnType<typeof vi.fn>>;
  let provisioning: { reconcile: ReturnType<typeof vi.fn> };
  let access: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    prisma = createFakePrisma();
    audit = { log: vi.fn(async () => {}) };
    mikrotik = {
      createUserManagerUsers: vi.fn(async (inputs: any[]) => inputs),
      assignProfile: vi.fn(async () => ({ state: 'waiting', endTime: null })),
      createHotspotUser: vi.fn(async (input: any) => input),
    };
    clients = {
      forRouter: vi.fn(async () => mikrotik),
      forDefaultRouter: vi.fn(async () => mikrotik),
    };
    provisioning = {
      reconcile: vi.fn(async () => ({
        profileName: '1JOUR-2000AR',
        limitationName: null,
        actions: [],
      })),
    };
    access = { revoke: vi.fn(async () => ({ cookiesRemoved: 0, sessionsClosed: 0 })) };
    vi.mocked(voucherCode.generateVoucherCode).mockReset();
  });

  function buildService() {
    return new VouchersService(
      prisma as any,
      audit as any,
      clients as any,
      provisioning as any,
      access as any,
      tenantContext as any,
    );
  }

  it('génère la quantité demandée de vouchers, tous avec un code unique', async () => {
    const codes = ['AAA', 'BBB', 'CCC', 'DDD'];
    vi.mocked(voucherCode.generateVoucherCode).mockImplementation(() => codes.shift()!);

    const service = buildService();
    const result = await service.generateBatch(
      { planId: 'plan-1', quantity: 4 } as any,
      'admin-1',
    );

    expect(result).toHaveLength(4);
    expect(new Set(result.map((v) => v.code)).size).toBe(4);
    // Les comptes partent en une seule passe, pas un appel par ticket.
    expect(mikrotik.createUserManagerUsers).toHaveBeenCalledTimes(1);
    expect(mikrotik.createUserManagerUsers.mock.calls[0][0]).toHaveLength(4);
  });

  it('crée les comptes sur le routeur dès la génération, avec le code en mot de passe', async () => {
    // Un ticket imprimé doit fonctionner sans qu'un vendeur l'active.
    const codes = ['KF77', 'HRT7'];
    vi.mocked(voucherCode.generateVoucherCode).mockImplementation(() => codes.shift()!);

    const service = buildService();
    const result = await service.generateBatch(
      { planId: 'plan-1', quantity: 2 } as any,
      'admin-1',
    );

    const created = mikrotik.createUserManagerUsers.mock.calls[0][0];
    expect(created[0]).toMatchObject({ username: 'KF77', password: 'KF77' });
    expect(mikrotik.assignProfile).toHaveBeenCalledWith({
      username: 'KF77',
      profileName: '1JOUR-2000AR',
    });
    expect(result.every((v) => v.umUsername)).toBe(true);
  });

  /**
   * La cible d'un lot change le produit vendu, pas seulement l'endroit où
   * vit le compte. Ces cas figent la différence.
   */
  describe('cible du lot', () => {
    it('va sur User Manager par défaut, sans cible demandée', async () => {
      const codes = ['UM01', 'UM02'];
      vi.mocked(voucherCode.generateVoucherCode).mockImplementation(() => codes.shift()!);

      const result = await buildService().generateBatch(
        { planId: 'plan-1', quantity: 2 } as any,
        'admin-1',
      );

      // Le défaut compte : lui seul tient une validité calendaire.
      expect(mikrotik.createUserManagerUsers).toHaveBeenCalled();
      expect(mikrotik.createHotspotUser).not.toHaveBeenCalled();
      expect(result.every((v) => v.target === 'USER_MANAGER')).toBe(true);
    });

    it('crée sur le HotSpot avec un plafond de temps connecté quand on le demande', async () => {
      const codes = ['HS01', 'HS02'];
      vi.mocked(voucherCode.generateVoucherCode).mockImplementation(() => codes.shift()!);

      const result = await buildService().generateBatch(
        { planId: 'plan-1', quantity: 2, target: 'HOTSPOT' } as any,
        'admin-1',
      );

      expect(mikrotik.createUserManagerUsers).not.toHaveBeenCalled();
      expect(mikrotik.createHotspotUser).toHaveBeenCalledTimes(2);
      // `limit-uptime` et non le `session-timeout` du profil : celui-ci
      // repart à zéro à chaque reconnexion et ne borne donc rien.
      expect(mikrotik.createHotspotUser.mock.calls[0][0]).toMatchObject({
        username: 'HS01',
        password: 'HS01',
        profileName: '1JOUR-2000AR',
        limitUptimeSeconds: 86400,
      });
      expect(result.every((v) => v.target === 'HOTSPOT')).toBe(true);
      // Pas de compte User Manager : le confondre ferait chercher une
      // échéance calendaire qui n'existe pas.
      expect(result.every((v) => !v.umUsername)).toBe(true);
    });

    it('enregistre la cible sur le lot, pour que le suivi la montre', async () => {
      const codes = ['HS03'];
      vi.mocked(voucherCode.generateVoucherCode).mockImplementation(() => codes.shift()!);

      await buildService().generateBatch(
        { planId: 'plan-1', quantity: 1, target: 'HOTSPOT' } as any,
        'admin-1',
      );

      expect(prisma.voucherBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ target: 'HOTSPOT' }),
        }),
      );
    });
  });

  it("relance la génération quand le code aléatoire entre en collision avec un voucher existant", async () => {
    // 'DUP' est généré deux fois de suite avant que 'UNIQUE' ne soit tenté.
    const codes = ['DUP', 'DUP', 'UNIQUE'];
    vi.mocked(voucherCode.generateVoucherCode).mockImplementation(() => codes.shift()!);

    const service = buildService();
    const first = await (service as any).createVoucherWithUniqueCode({ planId: 'plan-1', priceAr: 2000 });
    expect(first.code).toBe('DUP');

    const second = await (service as any).createVoucherWithUniqueCode({ planId: 'plan-1', priceAr: 2000 });
    expect(second.code).toBe('UNIQUE');
    expect(prisma.voucher.create).toHaveBeenCalledTimes(3);
  });
});
