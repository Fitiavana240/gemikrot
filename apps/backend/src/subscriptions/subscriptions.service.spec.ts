import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { GRACE_PERIOD_DAYS, SubscriptionsService } from './subscriptions.service.js';

const tenantContext = { requireTenantId: () => 'tenant-1', get: () => ({ tenantId: 'tenant-1', isSuperAdmin: false }) };

const DAY_MS = 86_400_000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

function createFakePrisma(overrides: { periodEnd?: Date; graceEndsAt?: Date; status?: string } = {}) {
  const periodEnd = overrides.periodEnd ?? daysFromNow(10);
  const subscription = {
    id: 'sub-1',
    customerId: 'customer-1',
    planId: 'plan-1',
    routerId: 'router-1',
    hotspotUsername: 'Mario',
    status: overrides.status ?? 'ACTIVE',
    currentPeriodStart: daysFromNow(-20),
    currentPeriodEnd: periodEnd,
    graceEndsAt: overrides.graceEndsAt ?? new Date(periodEnd.getTime() + GRACE_PERIOD_DAYS * DAY_MS),
    suspendedAt: null,
  };

  const client: any = {
    _subscription: subscription,
    subscription: {
      findUnique: vi.fn(async () => subscription),
      findMany: vi.fn(async () => [subscription]),
      update: vi.fn(async ({ data }: any) => Object.assign(subscription, data)),
    },
    plan: {
      findUnique: vi.fn(async () => ({
        id: 'plan-1',
        name: '1Mois-15000Ar',
        kind: 'SUBSCRIPTION',
        subscriptionPeriodDays: 30,
        mikrotikProfileName: '1Mois-15000Ar',
      })),
    },
    device: {
      findMany: vi.fn(async () => [{ id: 'dev-1', mikrotikBindingId: '*1' }]),
      update: vi.fn(async () => ({})),
    },
  };
  // `scoped` renvoie le même faux client : le cloisonnement a son propre test.
  client.scoped = client;
  return client;
}

function createFakeMikrotik() {
  return {
    setUserManagerUserDisabled: vi.fn(async () => ({})),
    setIpBindingType: vi.fn(async () => ({})),
  };
}

describe('SubscriptionsService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let audit: { log: ReturnType<typeof vi.fn> };
  let mikrotik: ReturnType<typeof createFakeMikrotik>;
  let clients: Record<string, ReturnType<typeof vi.fn>>;

  function buildService(fakePrisma = prisma) {
    return new SubscriptionsService(
      fakePrisma as any,
      audit as any,
      clients as any,
      tenantContext as any,
    );
  }

  beforeEach(() => {
    prisma = createFakePrisma();
    audit = { log: vi.fn(async () => {}) };
    mikrotik = createFakeMikrotik();
    clients = {
      forRouter: vi.fn(async () => mikrotik),
      getDefaultRouterId: vi.fn(async () => 'router-1'),
    };
  });

  it('suspend le compte User Manager et bloque les appareils en contournement', async () => {
    const service = buildService();

    const suspended = await service.suspend('sub-1', 'admin-1');

    expect(suspended.status).toBe('SUSPENDED');
    // Suspension côté User Manager : le compte et son historique sont gardés.
    expect(mikrotik.setUserManagerUserDisabled).toHaveBeenCalledWith('Mario', true);
    // Décision produit : un appareil suspendu est bloqué, pas seulement
    // renvoyé vers le portail captif.
    expect(mikrotik.setIpBindingType).toHaveBeenCalledWith('*1', 'blocked');
  });

  it('refuse de suspendre deux fois le même abonnement', async () => {
    const service = buildService(createFakePrisma({ status: 'SUSPENDED' }));
    await expect(service.suspend('sub-1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('réactive le compte et rétablit le contournement au renouvellement', async () => {
    prisma = createFakePrisma({ status: 'SUSPENDED', periodEnd: daysFromNow(-3) });
    const service = buildService();

    const renewed = await service.renew('sub-1');

    expect(renewed.status).toBe('ACTIVE');
    expect(mikrotik.setUserManagerUserDisabled).toHaveBeenCalledWith('Mario', false);
    expect(mikrotik.setIpBindingType).toHaveBeenCalledWith('*1', 'bypassed');
  });

  it('prolonge depuis la fin de période en cours si le client paie en avance', async () => {
    const periodEnd = daysFromNow(10);
    prisma = createFakePrisma({ periodEnd });
    const service = buildService();

    const renewed = await service.renew('sub-1');

    // 10 jours restants + 30 jours de période = ~40 jours, pas 30.
    const daysAdded = Math.round((renewed.currentPeriodEnd.getTime() - Date.now()) / DAY_MS);
    expect(daysAdded).toBe(40);
  });

  it('recommande la suspension une fois la période de grâce écoulée', async () => {
    prisma = createFakePrisma({ periodEnd: daysFromNow(-10), graceEndsAt: daysFromNow(-3) });
    const service = buildService();

    const [recommendation] = await service.getRecommendations();

    expect(recommendation.reason).toBe('GRACE_ENDED');
    expect(recommendation.recommendedAction).toBe('SUSPEND');
    // Aucune action appliquée d'office : c'est l'administration qui décide.
    expect(mikrotik.setUserManagerUserDisabled).not.toHaveBeenCalled();
  });

  it('se contente d\'avertir tant que la période de grâce court', async () => {
    prisma = createFakePrisma({ periodEnd: daysFromNow(-2), graceEndsAt: daysFromNow(5) });
    const service = buildService();

    const [recommendation] = await service.getRecommendations();

    expect(recommendation.reason).toBe('IN_GRACE');
    expect(recommendation.recommendedAction).toBe('WARN_CUSTOMER');
  });
});
