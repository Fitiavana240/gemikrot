import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { RouterImportService } from './router-import.service.js';

/**
 * L'import est le seul point d'entrée qui **change d'exploitant en cours de
 * route** : il se place sur celui du routeur importé, parce que le SUPER_ADMIN
 * qui le déclenche n'en a pas.
 *
 * C'est exactement ce qui le rendait dangereux. Le routeur était résolu avec
 * le client brut, si bien qu'un ADMIN connaissant l'identifiant d'un routeur
 * d'un autre exploitant déclenchait un import dans les données de cet autre —
 * et en recevait le détail en réponse. Les tests de cloisonnement existants ne
 * pouvaient pas l'attraper : ils éprouvent l'extension Prisma, pas les
 * services qui choisissent de s'en passer.
 */
describe("RouterImportService — cloisonnement de l'import", () => {
  const tenantContext = new TenantContextService();
  const prisma = new PrismaService(tenantContext);

  /**
   * Le client MikroTik échoue bruyamment. Aucun test ici ne doit l'atteindre :
   * s'il est appelé, c'est que le routeur d'un autre exploitant a été résolu,
   * et la fuite est ouverte.
   */
  const clients = {
    forRouter: vi.fn(async () => {
      throw new Error('FUITE : le routeur a été résolu hors de son exploitant');
    }),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const detection = { detect: vi.fn(() => null) };

  const service = new RouterImportService(
    prisma,
    audit as never,
    clients as never,
    detection as never,
    tenantContext,
  );

  const suffix = Date.now();
  const tenantA = `imp-a-${suffix}`;
  const tenantB = `imp-b-${suffix}`;
  const routeurDeB = `routeur-b-${suffix}`;

  beforeAll(async () => {
    await prisma.$connect();
    for (const [id, name] of [
      [tenantA, 'Import A'],
      [tenantB, 'Import B'],
    ]) {
      await prisma.tenant.create({
        data: { id, slug: id, name, wifiName: name, currency: 'MGA', status: 'ACTIVE' },
      });
    }
    await prisma.router.create({
      data: {
        id: routeurDeB,
        tenantId: tenantB,
        label: 'Routeur de B',
        host: '10.250.0.1',
        credentialsEncrypted: 'peu-importe',
      },
    });
  });

  afterAll(async () => {
    await prisma.router.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await prisma.$disconnect();
  });

  it("refuse d'importer le routeur d'un autre exploitant", async () => {
    await expect(
      tenantContext.runAsTenant(tenantA, () => service.importFromRouter(routeurDeB)),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Le routeur n'a jamais été contacté : le refus tombe avant tout appel.
    expect(clients.forRouter).not.toHaveBeenCalled();
  });

  it("ne dit pas qu'un routeur existe ailleurs", async () => {
    // Un routeur d'un autre exploitant et un routeur inexistant doivent
    // produire le même message, sans quoi l'un se déduit de l'autre.
    const chezUnAutre = await tenantContext
      .runAsTenant(tenantA, () => service.importFromRouter(routeurDeB))
      .catch((error: Error) => error.message);
    const inexistant = await tenantContext
      .runAsTenant(tenantA, () => service.importFromRouter(`inconnu-${suffix}`))
      .catch((error: Error) => error.message);

    expect(chezUnAutre).toBe(`Routeur ${routeurDeB} introuvable`);
    expect(inexistant).toBe(`Routeur inconnu-${suffix} introuvable`);
  });

  it('laisse le SUPER_ADMIN atteindre le routeur de tout exploitant', async () => {
    // Le SUPER_ADMIN n'a pas d'exploitant : c'est le cas que la résolution
    // brute servait légitimement, et qui doit continuer de fonctionner.
    const atteint = await tenantContext
      .run({ tenantId: null, isSuperAdmin: true }, () => service.importFromRouter(routeurDeB))
      .catch((error: Error) => error.message);

    // Il va jusqu'au client MikroTik, donc jusqu'à l'échec volontaire du
    // faux client — preuve que la résolution a abouti.
    expect(atteint).toContain('FUITE');
    expect(clients.forRouter).toHaveBeenCalledWith(routeurDeB);
  });
});
