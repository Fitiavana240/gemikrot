import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MikrotikTimeoutError } from '@wifitati/mikrotik-service';
import { ROUTER_OPERATIONS, RouterOperationQueue } from './router-operation.service.js';
import { RouterHealthService } from './router-health.service.js';
import { RouterAccessService } from './router-access.service.js';

const TENANT = 'exploitant-1';
const ROUTER = 'routeur-1';

const tenantContext = {
  requireTenantId: () => TENANT,
  get: () => ({ tenantId: TENANT, isSuperAdmin: false }),
  runAsTenant: <T>(_tenantId: string, fn: () => T) => fn(),
};

/** Base en mémoire : le cloisonnement a son propre test. */
function createFakePrisma(seed: Record<string, unknown>[] = []) {
  const rows: Record<string, unknown>[] = seed.map((row, index) => ({
    id: `op-${index}`,
    tenantId: TENANT,
    routerId: ROUTER,
    status: 'EN_ATTENTE',
    attempts: 0,
    payload: {},
    createdAt: new Date(),
    ...row,
  }));

  const model = {
    findFirst: vi.fn(async ({ where }: any) =>
      rows.find(
        (row) =>
          row.kind === where.kind &&
          row.status === where.status &&
          JSON.stringify(row.payload) === JSON.stringify(where.payload?.equals),
      ) ?? null,
    ),
    findMany: vi.fn(async ({ where }: any) =>
      rows.filter((row) => (!where?.status || row.status === where.status)),
    ),
    create: vi.fn(async ({ data }: any) => {
      const row = { id: `op-${rows.length}`, attempts: 0, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row!, data);
      return row;
    }),
  };

  (model as any).groupBy = vi.fn(async ({ where }: any) => {
    const ids = new Set(
      rows.filter((r) => !where?.status || r.status === where.status).map((r) => r.routerId),
    );
    return [...ids].map((routerId) => ({ routerId }));
  });

  const client: any = { routerOperation: model, _rows: rows };
  client.scopedStrict = client;
  return client;
}

describe('RouterOperationQueue', () => {
  let health: RouterHealthService;
  let mikrotik: Record<string, ReturnType<typeof vi.fn>>;
  let clients: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    health = new RouterHealthService();
    mikrotik = {
      setUserManagerUserDisabled: vi.fn(async () => ({})),
      getHotspotCookies: vi.fn(async () => []),
      getHotspotActiveUsers: vi.fn(async () => []),
      disconnectHotspotUser: vi.fn(async () => undefined),
      deleteHotspotCookie: vi.fn(async () => undefined),
    };
    clients = { forRouter: vi.fn(async () => mikrotik) };
  });

  function build(prisma: ReturnType<typeof createFakePrisma>) {
    return new RouterOperationQueue(
      prisma as never,
      clients as never,
      new RouterAccessService(),
      health,
      tenantContext as never,
    );
  }

  describe('mise en file', () => {
    it('enregistre une opération avec son motif', async () => {
      const prisma = createFakePrisma();
      const queue = build(prisma);

      await queue.enqueue(
        ROUTER,
        ROUTER_OPERATIONS.COUPER_ACCES,
        { username: 'KF77' },
        'routeur injoignable',
      );

      expect(prisma.routerOperation.create).toHaveBeenCalledTimes(1);
      expect(prisma._rows[0]).toMatchObject({ kind: 'COUPER_ACCES', reason: 'routeur injoignable' });
    });

    it('ne double pas une opération déjà en attente', async () => {
      // La file garantit au moins une exécution : deux lignes identiques
      // donneraient deux exécutions sans rien apporter.
      const prisma = createFakePrisma([
        { kind: ROUTER_OPERATIONS.COUPER_ACCES, payload: { username: 'KF77' } },
      ]);
      const queue = build(prisma);

      await queue.enqueue(ROUTER, ROUTER_OPERATIONS.COUPER_ACCES, { username: 'KF77' }, 'encore');

      expect(prisma.routerOperation.create).not.toHaveBeenCalled();
      expect(prisma._rows).toHaveLength(1);
    });
  });

  describe('vidange', () => {
    it('rejoue la coupure et marque terminée', async () => {
      const prisma = createFakePrisma([
        { kind: ROUTER_OPERATIONS.COUPER_ACCES, payload: { username: 'KF77' } },
      ]);

      const report = await build(prisma).drain(ROUTER);

      expect(report.done).toBe(1);
      expect(mikrotik.setUserManagerUserDisabled).toHaveBeenCalledWith('KF77', true);
      expect(prisma._rows[0].status).toBe('TERMINEE');
      expect(prisma._rows[0].completedAt).toBeInstanceOf(Date);
    });

    it("s'arrête dès que le routeur retombe, sans épuiser la file", async () => {
      // Insister contre un lien mort brûlerait les tentatives de toutes les
      // opérations d'un coup ; le prochain retour reprendra où on en est.
      const prisma = createFakePrisma([
        { kind: ROUTER_OPERATIONS.COUPER_ACCES, payload: { username: 'A' } },
        { kind: ROUTER_OPERATIONS.COUPER_ACCES, payload: { username: 'B' } },
        { kind: ROUTER_OPERATIONS.COUPER_ACCES, payload: { username: 'C' } },
      ]);
      mikrotik.setUserManagerUserDisabled = vi.fn(async () => {
        health.recordFailure(ROUTER, new MikrotikTimeoutError('délai dépassé'));
        throw new MikrotikTimeoutError('délai dépassé');
      });
      // Deux échecs déjà encaissés : le troisième ouvre le disjoncteur.
      health.recordFailure(ROUTER, new MikrotikTimeoutError('délai dépassé'));
      health.recordFailure(ROUTER, new MikrotikTimeoutError('délai dépassé'));

      const report = await build(prisma).drain(ROUTER);

      expect(report.done).toBe(0);
      expect(report.failed).toBe(1);
      expect(prisma._rows[1].status).toBe('EN_ATTENTE');
      expect(prisma._rows[2].status).toBe('EN_ATTENTE');
    });

    it('abandonne en le disant, après dix tentatives', async () => {
      const prisma = createFakePrisma([
        { kind: ROUTER_OPERATIONS.COUPER_ACCES, payload: { username: 'KF77' }, attempts: 9 },
      ]);
      mikrotik.setUserManagerUserDisabled = vi.fn(async () => {
        throw new Error('refus persistant');
      });

      const report = await build(prisma).drain(ROUTER);

      expect(report.abandoned).toBe(1);
      expect(prisma._rows[0].status).toBe('ABANDONNEE');
      // L'état reste visible et motivé : abandonner en silence serait pire
      // que ne rien faire.
      expect(prisma._rows[0].lastError).toContain('refus persistant');
    });

    it('abandonne une opération inconnue au lieu de la rejouer sans fin', async () => {
      const prisma = createFakePrisma([
        { kind: 'OPERATION_DUNE_AUTRE_VERSION', payload: {}, attempts: 9 },
      ]);

      const report = await build(prisma).drain(ROUTER);

      expect(report.abandoned).toBe(1);
      expect(prisma._rows[0].lastError).toContain('Opération inconnue');
    });

    it('ne vide pas deux fois en parallèle', async () => {
      const prisma = createFakePrisma([
        { kind: ROUTER_OPERATIONS.COUPER_ACCES, payload: { username: 'KF77' } },
      ]);
      const queue = build(prisma);

      const [first, second] = await Promise.all([queue.drain(ROUTER), queue.drain(ROUTER)]);

      // L'une fait le travail, l'autre repart sans rien faire.
      expect(first.done + second.done).toBe(1);
      expect(mikrotik.setUserManagerUserDisabled).toHaveBeenCalledTimes(1);
    });
  });

  it('se vide quand le routeur redevient joignable', async () => {
    const prisma = createFakePrisma([
      { kind: ROUTER_OPERATIONS.COUPER_ACCES, payload: { username: 'KF77' } },
    ]);
    const queue = build(prisma);
    queue.onModuleInit();

    // Le routeur tombe, puis revient : le disjoncteur prévient la file.
    for (let i = 0; i < 3; i += 1) {
      health.recordFailure(ROUTER, new MikrotikTimeoutError('délai dépassé'));
    }
    health.recordSuccess(ROUTER);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(prisma._rows[0].status).toBe('TERMINEE');
  });
});

/**
 * La reprise au démarrage.
 *
 * L'état de santé des routeurs vit en mémoire : après un redémarrage, tout
 * routeur repart d'`INCONNU`, si bien que le premier appel réussi ne compte
 * pas comme un retour — `recordSuccess` ne prévient ses écoutes que si l'état
 * était `INJOIGNABLE`. Ce qui avait été mis en file avant l'arrêt y restait
 * donc jusqu'à ce que le routeur retombe puis revienne. Or les deux se
 * produisent ensemble : une coupure de courant emporte serveur et routeur.
 */
describe('RouterOperationQueue, reprise au démarrage', () => {
  function monter(prisma: any, mikrotik: Record<string, any>) {
    const health = new RouterHealthService();
    const queue = new RouterOperationQueue(
      prisma,
      { forRouter: vi.fn(async () => mikrotik) } as never,
      new RouterAccessService(),
      health as never,
      tenantContext as never,
    );
    return { queue, health };
  }

  const mikrotikSain = () => ({
    getHotspotCookies: vi.fn(async () => []),
    getHotspotActiveUsers: vi.fn(async () => []),
    deleteHotspotCookie: vi.fn(async () => undefined),
    disconnectHotspotUser: vi.fn(async () => undefined),
    setUserManagerUserDisabled: vi.fn(async () => ({})),
  });

  it('rejoue ce qui attendait, sans attendre de reconnexion', async () => {
    const prisma = createFakePrisma([
      { kind: ROUTER_OPERATIONS.COUPER_ACCES, payload: { username: 'KF77' } },
    ]);
    const { queue } = monter(prisma, mikrotikSain());

    queue.onModuleInit();
    // La reprise est détachée : on laisse la micro-tâche s'exécuter.
    await new Promise((r) => setTimeout(r, 0));

    expect(prisma._rows[0].status).toBe('TERMINEE');
  });

  it('ne touche à rien quand la file est vide', async () => {
    const prisma = createFakePrisma([]);
    const { queue } = monter(prisma, mikrotikSain());

    queue.onModuleInit();
    await new Promise((r) => setTimeout(r, 0));

    expect(prisma.routerOperation.update).not.toHaveBeenCalled();
  });

  it('laisse l’application démarrer même si la reprise échoue', async () => {
    // Une base indisponible au démarrage ne doit pas empêcher le service de
    // se monter : la file sera reprise au prochain retour du routeur.
    const prisma = createFakePrisma([]);
    prisma.routerOperation.groupBy = vi.fn(async () => {
      throw new Error('base injoignable');
    });
    const { queue } = monter(prisma, mikrotikSain());

    expect(() => queue.onModuleInit()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
