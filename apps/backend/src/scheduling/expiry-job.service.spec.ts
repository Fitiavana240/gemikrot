import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RouterUnreachableException } from '../routers/router-health.service.js';
import { RouterAccessService } from '../routers/router-access.service.js';
import { ExpiryJobService } from './expiry-job.service.js';

const TENANT = 'exploitant-1';

const tenantContext = {
  requireTenantId: () => TENANT,
  get: () => ({ tenantId: TENANT, isSuperAdmin: false }),
  runAsTenant: <T>(_id: string, fn: () => T) => fn(),
};

function createFakePrisma(options: { vouchers?: any[]; subscriptions?: any[] } = {}) {
  const vouchers = options.vouchers ?? [];
  const subscriptions = options.subscriptions ?? [];

  const client: any = {
    tenant: { findMany: vi.fn(async () => [{ id: TENANT }]) },
    voucher: {
      findMany: vi.fn(async () => vouchers),
      update: vi.fn(async ({ where, data }: any) => {
        Object.assign(vouchers.find((v) => v.id === where.id), data);
      }),
    },
    subscription: {
      findMany: vi.fn(async () => subscriptions),
      update: vi.fn(async ({ where, data }: any) => {
        Object.assign(subscriptions.find((s) => s.id === where.id), data);
      }),
    },
    _vouchers: vouchers,
    _subscriptions: subscriptions,
  };
  client.scopedStrict = client;
  return client;
}

describe('ExpiryJobService', () => {
  let mikrotik: Record<string, ReturnType<typeof vi.fn>>;
  let clients: Record<string, ReturnType<typeof vi.fn>>;
  let operations: { enqueue: ReturnType<typeof vi.fn>; pending: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mikrotik = {
      setUserManagerUserDisabled: vi.fn(async () => ({})),
      getHotspotCookies: vi.fn(async () => [{ id: '*1', username: 'KF77' }]),
      getHotspotActiveUsers: vi.fn(async () => [{ id: '*2', username: 'KF77' }]),
      deleteHotspotCookie: vi.fn(async () => undefined),
      disconnectHotspotUser: vi.fn(async () => undefined),
    };
    clients = {
      forRouter: vi.fn(async () => mikrotik),
      getDefaultRouterId: vi.fn(async () => 'routeur-1'),
    };
    operations = { enqueue: vi.fn(async () => ({})), pending: vi.fn(async () => []) };
  });

  const build = (prisma: any) =>
    new ExpiryJobService(
      prisma,
      clients as never,
      new RouterAccessService(),
      operations as never,
      tenantContext as never,
    );

  const ticketÉchu = () => ({
    id: 'v-1',
    code: 'KF77',
    umUsername: 'KF77',
    status: 'ACTIVE',
  });

  it("coupe réellement l'accès d'un ticket échu, cookies et session compris", async () => {
    // Désactiver le compte ne suffit pas : un cookie encore valide rouvre la
    // session sans repasser par RADIUS, donc sans consulter la validité.
    const prisma = createFakePrisma({ vouchers: [ticketÉchu()] });

    const report = await build(prisma).run();

    expect(report.vouchersExpired).toBe(1);
    expect(report.accessCut).toBe(1);
    expect(prisma._vouchers[0].status).toBe('EXPIRED');
    expect(mikrotik.deleteHotspotCookie).toHaveBeenCalledWith('*1');
    expect(mikrotik.disconnectHotspotUser).toHaveBeenCalledWith({ sessionId: '*2' });
  });

  it('garde le compte en place : il est la trace de ce qui a été vendu', async () => {
    const prisma = createFakePrisma({ vouchers: [ticketÉchu()] });
    await build(prisma).run();

    // `disableAccount: false` — seul l'accès tombe.
    expect(mikrotik.setUserManagerUserDisabled).not.toHaveBeenCalled();
  });

  it('met la coupure en file quand le routeur est injoignable', async () => {
    // Sans cela, le ticket serait marqué expiré et son accès resterait
    // ouvert : personne ne repasserait jamais le couper.
    clients.forRouter = vi.fn(async () => {
      throw new RouterUnreachableException('hAP', 'pas de réponse');
    });
    const prisma = createFakePrisma({ vouchers: [ticketÉchu()] });

    const report = await build(prisma).run();

    expect(report.deferred).toBe(1);
    expect(report.accessCut).toBe(0);
    expect(operations.enqueue).toHaveBeenCalledWith(
      'routeur-1',
      'COUPER_ACCES',
      { username: 'KF77' },
      expect.stringContaining('KF77'),
    );
  });

  it('suspend un abonné dont la tolérance est épuisée', async () => {
    // Rien ne le faisait : un impayé restait connecté tant qu'un humain ne
    // s'en apercevait pas.
    const prisma = createFakePrisma({
      subscriptions: [
        { id: 's-1', hotspotUsername: 'Mario', routerId: 'routeur-1', status: 'GRACE' },
      ],
    });

    const report = await build(prisma).run();

    expect(report.subscriptionsSuspended).toBe(1);
    expect(prisma._subscriptions[0].status).toBe('SUSPENDED');
    expect(prisma._subscriptions[0].suspendedAt).toBeInstanceOf(Date);
    // Ici le compte est bien désactivé : l'abonnement, lui, n'est pas vendu
    // d'avance comme un ticket.
    expect(mikrotik.setUserManagerUserDisabled).toHaveBeenCalledWith('Mario', true);
  });

  it("ne marque pas suspendu ce que le routeur n'a pas coupé", async () => {
    // La base dirait suspendu pendant que le client navigue. L'opération part
    // en file, et le statut suivra au prochain passage.
    clients.forRouter = vi.fn(async () => {
      throw new RouterUnreachableException('hAP', 'pas de réponse');
    });
    const prisma = createFakePrisma({
      subscriptions: [
        { id: 's-1', hotspotUsername: 'Mario', routerId: 'routeur-1', status: 'ACTIVE' },
      ],
    });

    const report = await build(prisma).run();

    expect(report.subscriptionsSuspended).toBe(0);
    expect(prisma._subscriptions[0].status).toBe('ACTIVE');
    expect(operations.enqueue).toHaveBeenCalledWith(
      'routeur-1',
      'BASCULER_COMPTE',
      { username: 'Mario', disabled: true },
      expect.stringContaining('Mario'),
    );
  });

  it("n'interrompt pas le parc quand un exploitant échoue", async () => {
    // Un seul routeur injoignable ne doit pas priver les autres du passage.
    const prisma = createFakePrisma();
    prisma.tenant.findMany = vi.fn(async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    let appels = 0;
    prisma.voucher.findMany = vi.fn(async () => {
      appels += 1;
      if (appels === 2) throw new Error('exploitant b en échec');
      return [];
    });

    const report = await build(prisma).run();

    expect(appels).toBe(3);
    expect(report.vouchersExpired).toBe(0);
  });
});

/**
 * L'aperçu doit dire exactement ce que le travail ferait.
 *
 * Sa raison d'être est de permettre d'allumer l'ordonnanceur en connaissance
 * de cause. Un aperçu qui diverge du travail qu'il annonce est pire que pas
 * d'aperçu : il autorise une décision sur une fausse promesse.
 */
describe('ExpiryJobService.apercu', () => {
  const clients = {
    forRouter: vi.fn(async () => ({})),
    getDefaultRouterId: vi.fn(async () => 'routeur-1'),
  };
  const build = (prisma: any) =>
    new ExpiryJobService(
      prisma,
      clients as never,
      new RouterAccessService(),
      { enqueue: vi.fn(), pending: vi.fn() } as never,
      tenantContext as never,
    );

  it('n’écrit rien', async () => {
    // La propriété qui compte : on consulte l'aperçu pour décider, pas pour
    // déclencher.
    const prisma = createFakePrisma({
      vouchers: [{ id: 'v-1', code: 'KF77', expiresAt: new Date(0), status: 'SOLD' }],
      subscriptions: [{ id: 's-1', hotspotUsername: 'Mario', graceEndsAt: new Date(0) }],
    });

    await build(prisma).apercu();

    expect(prisma.voucher.update).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('interroge sur les mêmes critères que le travail', async () => {
    // Les deux `where` sont recopiés du travail : ce test les fige, pour que
    // l'un ne dérive pas de l'autre sans qu'on s'en aperçoive.
    const prisma = createFakePrisma();

    await build(prisma).apercu();

    const oùTickets = prisma.voucher.findMany.mock.calls[0][0].where;
    expect(oùTickets.expiresAt.not).toBeNull();
    expect(oùTickets.status.in).toEqual(['SOLD', 'ACTIVE']);
    expect(oùTickets.umUsername.not).toBeNull();

    const oùAbonnés = prisma.subscription.findMany.mock.calls[0][0].where;
    expect(oùAbonnés.status.in).toEqual(['ACTIVE', 'GRACE']);
    expect(oùAbonnés.graceEndsAt.lte).toBeInstanceOf(Date);
  });

  it('rend les deux listes vides quand rien n’est échu', async () => {
    const r = await build(createFakePrisma()).apercu();

    expect(r).toEqual({ ticketsAExpirer: [], abonnesASuspendre: [] });
  });
});
