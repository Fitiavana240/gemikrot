import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from './tenant-context.service.js';

/**
 * Le cloisonnement est la garantie la plus sensible de la plateforme : un
 * exploitant ne doit jamais voir ni modifier les données d'un autre. Ce test
 * s'exécute contre la vraie base et doit échouer si le filtrage automatique
 * saute — c'est précisément ce qu'on ne peut pas se permettre de découvrir
 * en production.
 */
describe('Cloisonnement entre exploitants', () => {
  const tenantContext = new TenantContextService();
  const prisma = new PrismaService(tenantContext);

  const suffix = Date.now();
  const tenantA = `test-tenant-a-${suffix}`;
  const tenantB = `test-tenant-b-${suffix}`;

  beforeAll(async () => {
    await prisma.$connect();
    for (const [id, name] of [
      [tenantA, 'Test A'],
      [tenantB, 'Test B'],
    ]) {
      await prisma.tenant.create({
        data: { id, slug: id, name, wifiName: name, currency: 'MGA', status: 'ACTIVE' },
      });
    }

    // Un client chez chaque exploitant, portant volontairement le même
    // numéro : l'unicité est désormais relative à l'exploitant.
    await prisma.customer.createMany({
      data: [
        { tenantId: tenantA, name: 'Client A', phone: `+261${suffix}` },
        { tenantId: tenantB, name: 'Client B', phone: `+261${suffix}` },
      ],
    });
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await prisma.$disconnect();
  });

  it("ne renvoie que les clients de l'exploitant courant", async () => {
    const seenByA = await tenantContext.runAsTenant(tenantA, () =>
      prisma.scoped.customer.findMany(),
    );

    expect(seenByA.map((c) => c.name)).toEqual(['Client A']);
    expect(seenByA.some((c) => c.tenantId === tenantB)).toBe(false);
  });

  it("empêche de lire par identifiant un client d'un autre exploitant", async () => {
    const customerB = await prisma.customer.findFirstOrThrow({ where: { tenantId: tenantB } });

    const found = await tenantContext.runAsTenant(tenantA, () =>
      prisma.scoped.customer.findFirst({ where: { id: customerB.id } }),
    );

    expect(found).toBeNull();
  });

  it("empêche de modifier les données d'un autre exploitant", async () => {
    const customerB = await prisma.customer.findFirstOrThrow({ where: { tenantId: tenantB } });

    const updated = await tenantContext.runAsTenant(tenantA, () =>
      prisma.scoped.customer.updateMany({
        where: { id: customerB.id },
        data: { name: 'Piraté' },
      }),
    );

    expect(updated.count).toBe(0);
    const untouched = await prisma.customer.findUniqueOrThrow({ where: { id: customerB.id } });
    expect(untouched.name).toBe('Client B');
  });

  it("empêche de supprimer les données d'un autre exploitant", async () => {
    const customerB = await prisma.customer.findFirstOrThrow({ where: { tenantId: tenantB } });

    const deleted = await tenantContext.runAsTenant(tenantA, () =>
      prisma.scoped.customer.deleteMany({ where: { id: customerB.id } }),
    );

    expect(deleted.count).toBe(0);
    await expect(
      prisma.customer.findUniqueOrThrow({ where: { id: customerB.id } }),
    ).resolves.toBeTruthy();
  });

  it('rattache automatiquement les lignes créées à l\'exploitant courant', async () => {
    const created = await tenantContext.runAsTenant(tenantA, () =>
      prisma.scoped.customer.create({
        data: { name: 'Créé sans tenantId', phone: `+261${suffix}-auto` } as never,
      }),
    );

    expect(created.tenantId).toBe(tenantA);
  });

  it('laisse le SUPER_ADMIN voir tous les exploitants', async () => {
    const seen = await tenantContext.run({ tenantId: null, isSuperAdmin: true }, () =>
      prisma.scoped.customer.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } }),
    );

    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  describe('scopedStrict', () => {
    it('refuse de travailler hors de tout exploitant', () => {
      // `scoped` dégraderait ici en client non cloisonné et renverrait les
      // lignes de tout le monde : c'est exactement ce qu'une tâche de fond ou
      // un point d'entrée public ne doit pas pouvoir faire par inadvertance.
      expect(() => prisma.scopedStrict.customer.findMany()).toThrow(
        /sans exploitant/i,
      );
    });

    it("cloisonne dès qu'un exploitant est posé", async () => {
      const seenByA = await tenantContext.runAsTenant(tenantA, () =>
        prisma.scopedStrict.customer.findMany(),
      );

      expect(seenByA.every((c) => c.tenantId === tenantA)).toBe(true);
      expect(seenByA.some((c) => c.name === 'Client A')).toBe(true);
    });
  });
});
