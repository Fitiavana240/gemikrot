import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from './tenant-context.service.js';

/**
 * Le cloisonnement, tel que PostgreSQL le fait respecter.
 *
 * L'extension Prisma est un filet, pas une garantie : elle ne protège que le
 * code qui pense à passer par le client cloisonné. La fuite trouvée à l'import
 * de routeur l'a montré — un service utilisant le client brut y échappait
 * entièrement.
 *
 * Ces tests écrivent donc avec le client **non cloisonné**, délibérément, et
 * vérifient que la base refuse quand même. C'est la seule façon d'éprouver une
 * contrainte de base de données : en contournant tout ce qui la précède.
 */
describe('Clés étrangères composites', () => {
  const tenantContext = new TenantContextService();
  const prisma = new PrismaService(tenantContext);

  const suffix = Date.now();
  const tenantA = `fk-a-${suffix}`;
  const tenantB = `fk-b-${suffix}`;
  const clientDeA = `client-a-${suffix}`;
  const offreDeA = `offre-a-${suffix}`;
  const offreDeB = `offre-b-${suffix}`;
  const routeurDeA = `routeur-a-${suffix}`;

  beforeAll(async () => {
    await prisma.$connect();
    for (const [id, name] of [
      [tenantA, 'FK A'],
      [tenantB, 'FK B'],
    ]) {
      await prisma.tenant.create({
        data: { id, slug: id, name, wifiName: name, currency: 'MGA', status: 'ACTIVE' },
      });
    }
    await prisma.customer.create({
      data: { id: clientDeA, tenantId: tenantA, name: 'Client de A', phone: `03400${suffix % 100000}` },
    });
    await prisma.router.create({
      data: {
        id: routeurDeA,
        tenantId: tenantA,
        label: 'Routeur de A',
        host: '10.251.0.1',
        credentialsEncrypted: 'peu-importe',
      },
    });
    for (const [id, tenantId, name] of [
      [offreDeA, tenantA, 'Offre de A'],
      [offreDeB, tenantB, 'Offre de B'],
    ]) {
      await prisma.plan.create({
        data: {
          id,
          tenantId,
          name,
          price: 1000,
          validityDurationSeconds: 86_400,
          mikrotikProfileName: name,
        },
      });
    }
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await prisma.payment.deleteMany({ where: { tenantId } });
      await prisma.subscription.deleteMany({ where: { tenantId } });
      await prisma.plan.deleteMany({ where: { tenantId } });
      await prisma.router.deleteMany({ where: { tenantId } });
      await prisma.customer.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  it("refuse un paiement rattaché au client d'un autre exploitant", async () => {
    // Le cas nommé dans le plan : avant ces clés, la base l'acceptait.
    await expect(
      prisma.payment.create({
        data: {
          tenantId: tenantB,
          customerId: clientDeA,
          planId: offreDeB,
          amount: 5000,
          currency: 'MGA',
          method: 'CASH',
          reference: `ref-${suffix}`,
        },
      }),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it("refuse un abonnement dont l'offre appartient à un autre exploitant", async () => {
    await expect(
      prisma.subscription.create({
        data: {
          tenantId: tenantA,
          customerId: clientDeA,
          planId: offreDeB,
          routerId: routeurDeA,
          hotspotUsername: `abonne-${suffix}`,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 86_400_000),
          graceEndsAt: new Date(Date.now() + 7 * 86_400_000),
        },
      }),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it('accepte le même abonnement quand tout appartient au bon exploitant', async () => {
    // La contrainte doit refuser le mélange, pas gêner le cas normal.
    const abonnement = await prisma.subscription.create({
      data: {
        tenantId: tenantA,
        customerId: clientDeA,
        planId: offreDeA,
        routerId: routeurDeA,
        hotspotUsername: `abonne-ok-${suffix}`,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        graceEndsAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });

    expect(abonnement.tenantId).toBe(tenantA);
  });

  it("refuse de déplacer une ligne chez un autre exploitant après coup", async () => {
    // Une mise à jour peut casser l'invariant tout autant qu'une création :
    // changer le tenant d'une offre orpheline la détacherait de ses
    // abonnements. La contrainte doit tenir dans les deux sens.
    await expect(
      prisma.plan.update({ where: { id: offreDeA }, data: { tenantId: tenantB } }),
    ).rejects.toThrow(/foreign key constraint/i);
  });
});
