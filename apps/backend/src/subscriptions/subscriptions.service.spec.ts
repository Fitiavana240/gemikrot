import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { GRACE_PERIOD_DAYS, SubscriptionsService } from './subscriptions.service.js';
import { MikrotikNotFoundError } from '@wifitati/mikrotik-service';

const tenantContext = { requireTenantId: () => 'tenant-1', get: () => ({ tenantId: 'tenant-1', isSuperAdmin: false }) };

const DAY_MS = 86_400_000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

/**
 * La fin de période du dernier abonnement fabriqué.
 *
 * Le simulacre du routeur en a besoin : User Manager **empile** les
 * attributions — une nouvelle part de la fin de la précédente, pas de
 * maintenant. Sans cela, le cas « le client paie en avance » ne serait pas
 * éprouvé, et c'est précisément celui où l'on peut lui voler des jours.
 */
let finDePeriodeCourante = 0;

function createFakePrisma(overrides: { periodEnd?: Date; graceEndsAt?: Date; status?: string } = {}) {
  const periodEnd = overrides.periodEnd ?? daysFromNow(10);
  finDePeriodeCourante = periodEnd.getTime();
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
    // Le routeur calcule l'échéance et la rend : c'est elle qui fait
    // autorité, pas l'addition de jours faite en base. User Manager
    // **empile** les attributions — une nouvelle part de la fin de la
    // précédente, pas de maintenant — et le simulacre le reproduit, faute
    // de quoi le cas « paie en avance » ne serait pas éprouvé.
    assignProfile: vi.fn(async () => ({
      id: '*9',
      username: 'Mario',
      profileName: '1Mois',
      endTime: daysFromNow(
        finDePeriodeCourante > Date.now() ? 30 + (finDePeriodeCourante - Date.now()) / DAY_MS : 30,
      ).toISOString(),
      state: 'running-active',
      usernameIntrouvable: false,
    })),
  };
}

describe('SubscriptionsService', () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let audit: { log: ReturnType<typeof vi.fn> };
  let mikrotik: ReturnType<typeof createFakeMikrotik>;
  let clients: Record<string, ReturnType<typeof vi.fn>>;
  let provisioning: { reconcile: ReturnType<typeof vi.fn> };
  let access: { revoke: ReturnType<typeof vi.fn> };

  function buildService(fakePrisma = prisma) {
    return new SubscriptionsService(
      fakePrisma as any,
      audit as any,
      clients as any,
      provisioning as any,
      tenantContext as any,
      access as any,
    );
  }

  beforeEach(() => {
    prisma = createFakePrisma();
    audit = { log: vi.fn(async () => {}) };
    access = { revoke: vi.fn(async () => ({ cookiesRemoved: 0, sessionsClosed: 0 })) };
    mikrotik = createFakeMikrotik();
    clients = {
      forRouter: vi.fn(async () => mikrotik),
      getDefaultRouterId: vi.fn(async () => 'router-1'),
    };
    provisioning = {
      reconcile: vi.fn(async () => ({
        profileName: '1Mois-15000Ar',
        limitationName: null,
        actions: [],
      })),
    };
  });

  it('suspend le compte User Manager et bloque les appareils en contournement', async () => {
    const service = buildService();

    const suspended = await service.suspend('sub-1', 'admin-1');

    expect(suspended.status).toBe('SUSPENDED');
    // Suspension côté User Manager : le compte et son historique sont gardés.
    // Passe par `revoke`, et non par une simple désactivation : un compte
    // seulement désactivé laisse la session en cours ouverte, et le
    // `mac-cookie` du client vaut encore trois jours. C'était une suspension
    // **plus faible** que celle du travail planifié, qui coupe pour de bon.
    expect(access.revoke).toHaveBeenCalledWith(mikrotik, 'Mario', { disableAccount: true });
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

  it("repousse l'échéance sur le routeur, et pas seulement en base", async () => {
    // Le défaut réparé : réactiver le compte le rendait acceptable de
    // nouveau, mais sa validité restait échue côté User Manager. Le client
    // payait, l'écran affichait « actif », et le routeur le refusait quand
    // même.
    prisma = createFakePrisma({ status: 'SUSPENDED', periodEnd: daysFromNow(-3) });
    const service = buildService();

    await service.renew('sub-1', undefined, 'admin-1');

    expect(mikrotik.assignProfile).toHaveBeenCalledWith({
      username: 'Mario',
      profileName: expect.any(String),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RENEW_SUBSCRIPTION',
        result: 'SUCCESS',
        payloadDiff: expect.objectContaining({ echeancePousseeSurLeRouteur: true }),
      }),
    );
  });

  it("enregistre le renouvellement même si le routeur ne répond pas, et le dit", async () => {
    // L'argent est encaissé : refuser d'enregistrer perdrait la trace du
    // paiement. Mais un abonné payé et toujours expiré côté routeur doit se
    // voir dans le journal, pas se deviner.
    prisma = createFakePrisma({ periodEnd: daysFromNow(-1) });
    mikrotik.assignProfile.mockRejectedValueOnce(new Error('routeur injoignable'));
    const service = buildService();

    const renewed = await service.renew('sub-1', undefined, 'admin-1');

    expect(renewed.status).toBe('ACTIVE');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RENEW_SUBSCRIPTION',
        result: 'FAILURE',
        payloadDiff: expect.objectContaining({
          echeancePousseeSurLeRouteur: false,
          motif: 'routeur injoignable',
        }),
      }),
    );
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

  it("ne raccourcit jamais la période payée, même si le routeur l'annonce plus tôt", async () => {
    // Si le routeur repartait de maintenant au lieu d'empiler, retenir son
    // échéance volerait au client les jours qu'il lui restait. On garde la
    // nôtre, et la divergence est dite plutôt que lissée.
    prisma = createFakePrisma({ periodEnd: daysFromNow(10) });
    mikrotik.assignProfile.mockResolvedValueOnce({
      id: '*9',
      username: 'Mario',
      profileName: '1Mois',
      endTime: daysFromNow(30).toISOString(),
      state: 'running-active',
      usernameIntrouvable: false,
    });
    const service = buildService();

    const renewed = await service.renew('sub-1', undefined, 'admin-1');

    const joursAjoutes = Math.round((renewed.currentPeriodEnd.getTime() - Date.now()) / DAY_MS);
    expect(joursAjoutes).toBe(40);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadDiff: expect.objectContaining({ motif: expect.stringContaining('plus tôt') }),
      }),
    );
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

  describe('reprise et statut dérivé', () => {
    it('rend ACTIVE quand la période court encore', async () => {
      const service = buildService(
        createFakePrisma({ status: 'SUSPENDED', periodEnd: daysFromNow(10) }),
      );

      const repris = await service.resume('sub-1', 'admin-1');

      expect(repris.status).toBe('ACTIVE');
      expect(repris.suspendedAt).toBeNull();
      expect(mikrotik.setUserManagerUserDisabled).toHaveBeenCalledWith('Mario', false);
    });

    it('rend GRACE quand la période est passée mais la tolérance court', async () => {
      const service = buildService(
        createFakePrisma({
          status: 'SUSPENDED',
          periodEnd: daysFromNow(-1),
          graceEndsAt: daysFromNow(2),
        }),
      );

      expect((await service.resume('sub-1', 'admin-1')).status).toBe('GRACE');
    });

    it('refuse la reprise quand la tolérance est épuisée', async () => {
      // Rouvrir l'accès ne prolongerait aucune échéance : le statut
      // retomberait aussitôt sur SUSPENDED tandis que le routeur laisserait
      // passer. La base dirait suspendu, le client naviguerait.
      const service = buildService(
        createFakePrisma({
          status: 'SUSPENDED',
          periodEnd: daysFromNow(-10),
          graceEndsAt: daysFromNow(-3),
        }),
      );

      await expect(service.resume('sub-1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);

      // Et surtout : le routeur n'a pas été touché. Un refus qui aurait déjà
      // rouvert l'accès serait pire que pas de refus du tout.
      expect(mikrotik.setUserManagerUserDisabled).not.toHaveBeenCalled();
      expect(mikrotik.setIpBindingType).not.toHaveBeenCalled();
    });
  });

});

/**
 * Le compte a disparu du routeur entre-temps.
 *
 * Relevé dans le journal d'audit de ce parc : une suspension avait écrit un
 * ÉCHEC et une RÉUSSITE pour le même geste, à la même seconde. `pushAccessState`
 * avalait l'absence du compte, si bien que l'appelant marquait l'abonnement
 * suspendu et journalisait un succès — alors que le routeur n'avait rien reçu
 * et que le client gardait son accès.
 */
describe('SubscriptionsService, compte absent du routeur', () => {
  function service(prisma: any, audit: any, access: any) {
    return new SubscriptionsService(
      prisma,
      audit,
      {
        forRouter: vi.fn(async () => ({
          setUserManagerUserDisabled: vi.fn(async () => ({})),
          setIpBindingType: vi.fn(async () => ({})),
        })),
        getDefaultRouterId: vi.fn(async () => 'router-1'),
      } as any,
      { reconcile: vi.fn() } as any,
      tenantContext as any,
      access,
    );
  }

  it('journalise un échec, et non une réussite, quand le routeur n’a rien reçu', async () => {
    const prisma = createFakePrisma();
    const audit = { log: vi.fn(async () => {}) };
    const access = {
      revoke: vi.fn(async () => {
        throw new MikrotikNotFoundError('Compte', 'Mario');
      }),
    };

    await service(prisma, audit, access).suspend('sub-1', 'admin-1');

    const suspensions = audit.log.mock.calls
      .map((c: any[]) => c[0])
      .filter((e: any) => e.action === 'SUSPEND_SUBSCRIPTION');
    // Une seule ligne, et c'est un échec : plus de couple contradictoire.
    expect(suspensions.filter((e: any) => e.result === 'SUCCESS')).toHaveLength(0);
    expect(suspensions.some((e: any) => e.payloadDiff?.routeurNonMisAJour === true)).toBe(true);
  });

  it('marque quand même l’abonnement suspendu en base', async () => {
    // Sinon un abonné dont le compte a disparu resterait actif à jamais dans
    // le suivi, et aucune relance ne partirait.
    const prisma = createFakePrisma();
    const access = {
      revoke: vi.fn(async () => {
        throw new MikrotikNotFoundError('Compte', 'Mario');
      }),
    };

    const r = await service(prisma, { log: vi.fn(async () => {}) }, access).suspend('sub-1');

    expect(r.status).toBe('SUSPENDED');
  });

  it('bloque les appareils en contournement malgré le compte absent', async () => {
    // Le compte peut manquer alors que les bindings existent : les laisser
    // passer serait le pire des deux mondes.
    const prisma = createFakePrisma();
    const access = {
      revoke: vi.fn(async () => {
        throw new MikrotikNotFoundError('Compte', 'Mario');
      }),
    };

    await service(prisma, { log: vi.fn(async () => {}) }, access).suspend('sub-1');

    expect(prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { bypassEnabled: false } }),
    );
  });
});
