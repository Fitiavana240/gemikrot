import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PlanProvisioningService } from './plan-provisioning.service.js';

const BASE_PLAN = {
  id: 'plan-1',
  name: '1Mois-15000Ar',
  price: 15000,
  kind: 'TICKET',
  validityDurationSeconds: 2_592_000,
  subscriptionPeriodDays: null,
  startsWhen: 'FIRST_AUTH',
  rateLimitRxBps: null,
  rateLimitTxBps: null,
  transferLimitBytes: null,
  maxSharedUsers: null,
  mikrotikProfileName: '1Mois-15000Ar',
  umProfileName: null,
  umLimitationName: null,
};

/**
 * Toutes les méthodes de l'interface, en `vi.fn()` : un appel HotSpot
 * inattendu est ainsi observable, au lieu de faire planter le test sur une
 * méthode absente et de se confondre avec une autre erreur.
 */
function createFakeMikrotik(overrides: Record<string, unknown> = {}) {
  return {
    getUserManagerProfiles: vi.fn(async () => [] as any[]),
    getUserManagerLimitations: vi.fn(async () => [] as any[]),
    getUserManagerProfileLimitations: vi.fn(async () => [] as any[]),
    createProfile: vi.fn(async () => ({})),
    updateProfile: vi.fn(async () => ({})),
    createLimitation: vi.fn(async () => ({})),
    updateLimitation: vi.fn(async () => ({})),
    deleteLimitation: vi.fn(async () => undefined),
    attachLimitationToProfile: vi.fn(async () => ({})),
    detachLimitationFromProfile: vi.fn(async () => undefined),
    // Le HotSpot local : aucun de ces appels ne doit partir.
    createHotspotProfile: vi.fn(async () => ({})),
    updateHotspotProfile: vi.fn(async () => ({})),
    createHotspotUser: vi.fn(async () => ({})),
    updateHotspotUser: vi.fn(async () => ({})),
    deleteHotspotUser: vi.fn(async () => undefined),
    setHotspotUserDisabled: vi.fn(async () => ({})),
    ...overrides,
  };
}

function createFakePrisma(plan: Record<string, unknown>) {
  const client: any = {
    plan: {
      findUnique: vi.fn(async () => plan),
      update: vi.fn(async ({ data }: any) => Object.assign(plan, data)),
    },
  };
  client.scopedStrict = client;
  return client;
}

describe('PlanProvisioningService', () => {
  let mikrotik: ReturnType<typeof createFakeMikrotik>;
  let clients: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    mikrotik = createFakeMikrotik();
    clients = {
      forDefaultRouter: vi.fn(async () => mikrotik),
      forRouter: vi.fn(async () => mikrotik),
    };
  });

  function build(plan: Record<string, unknown>) {
    const prisma = createFakePrisma(plan);
    return {
      prisma,
      service: new PlanProvisioningService(prisma as any, clients as any),
    };
  }

  it('ne touche jamais au HotSpot local', async () => {
    // Le routeur porte 646 comptes HotSpot vendus avant la bascule. Aucun
    // chemin nouveau ne doit pouvoir les modifier, même indirectement par
    // leur profil.
    const { service } = build({ ...BASE_PLAN });

    await service.reconcile('plan-1');

    expect(mikrotik.createHotspotProfile).not.toHaveBeenCalled();
    expect(mikrotik.updateHotspotProfile).not.toHaveBeenCalled();
    expect(mikrotik.createHotspotUser).not.toHaveBeenCalled();
    expect(mikrotik.deleteHotspotUser).not.toHaveBeenCalled();
    expect(mikrotik.setHotspotUserDisabled).not.toHaveBeenCalled();
  });

  it('crée le profil avec la validité de l\'offre et enregistre le rattachement', async () => {
    const plan = { ...BASE_PLAN };
    const { service, prisma } = build(plan);

    const report = await service.reconcile('plan-1');

    expect(mikrotik.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '1Mois-15000Ar',
        validityDurationSeconds: 2_592_000,
        startsWhen: 'first-auth',
        price: 15000,
      }),
    );
    expect(report.actions).toContain('profil 1Mois-15000Ar créé');
    expect(prisma.plan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ umProfileName: '1Mois-15000Ar' }),
      }),
    );
  });

  it('compte un abonnement en périodes plutôt qu\'en durée de validité', async () => {
    const { service } = build({
      ...BASE_PLAN,
      kind: 'SUBSCRIPTION',
      subscriptionPeriodDays: 30,
      // Volontairement incohérent : c'est la période qui doit gagner.
      validityDurationSeconds: 3600,
    });

    await service.reconcile('plan-1');

    expect(mikrotik.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ validityDurationSeconds: 30 * 86_400 }),
    );
  });

  it('n\'écrit rien quand le routeur est déjà conforme', async () => {
    mikrotik.getUserManagerProfiles = vi.fn(async () => [
      {
        id: '*1',
        name: '1Mois-15000Ar',
        validityDurationSeconds: 2_592_000,
        startsWhen: 'first-auth',
        price: 15000,
        overrideSharedUsers: null,
        nameForUsers: null,
        comment: null,
      },
    ]);
    const { service } = build({ ...BASE_PLAN, umProfileName: '1Mois-15000Ar' });

    const report = await service.reconcile('plan-1');

    expect(mikrotik.createProfile).not.toHaveBeenCalled();
    expect(mikrotik.updateProfile).not.toHaveBeenCalled();
    expect(report.actions).toEqual([]);
  });

  it('crée et rattache une limitation quand l\'offre impose des plafonds', async () => {
    const { service } = build({
      ...BASE_PLAN,
      rateLimitRxBps: 2_000_000,
      rateLimitTxBps: 1_000_000,
    });

    const report = await service.reconcile('plan-1');

    expect(mikrotik.createLimitation).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '1Mois-15000Ar-LIM',
        rateLimitRxBitsPerSecond: 2_000_000,
        rateLimitTxBitsPerSecond: 1_000_000,
      }),
    );
    expect(mikrotik.attachLimitationToProfile).toHaveBeenCalledWith({
      profileName: '1Mois-15000Ar',
      limitationName: '1Mois-15000Ar-LIM',
    });
    expect(report.limitationName).toBe('1Mois-15000Ar-LIM');
  });

  it('retire la limitation quand l\'offre cesse d\'imposer un plafond', async () => {
    // Sans ce retrait, l'ancien plafond continuerait de s'appliquer alors que
    // l'offre ne l'annonce plus.
    mikrotik.getUserManagerLimitations = vi.fn(async () => [
      {
        id: '*1',
        name: '1Mois-15000Ar-LIM',
        rateLimit: { rxBitsPerSecond: 2_000_000, txBitsPerSecond: null },
        transferLimitBytes: null,
        uptimeLimitSeconds: null,
      },
    ]);
    const { service } = build({ ...BASE_PLAN, umLimitationName: '1Mois-15000Ar-LIM' });

    const report = await service.reconcile('plan-1');

    expect(mikrotik.deleteLimitation).toHaveBeenCalledWith('1Mois-15000Ar-LIM');
    expect(report.limitationName).toBeNull();
  });

  it('adapte un nom de profil que User Manager refuserait', async () => {
    // Les profils importés portent des noms libres ; celui-ci transite par
    // l'URL REST une fois posé.
    const { service } = build({ ...BASE_PLAN, mikrotikProfileName: 'Ticket 25000Ar/2 Appareils' });

    const report = await service.reconcile('plan-1');

    expect(report.profileName).toBe('Ticket-25000Ar-2-Appareils');
  });
});
