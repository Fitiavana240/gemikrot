import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { JobLockService } from './job-lock.service.js';

/**
 * Le verrou est une garantie de base de données : l'éprouver suppose deux
 * détenteurs distincts, chacun avec sa propre identité. D'où deux instances du
 * service, comme deux processus de l'application.
 */
describe('JobLockService', () => {
  const prisma = new PrismaService(new TenantContextService());
  const premier = new JobLockService(prisma);
  const second = new JobLockService(prisma);

  const nom = `test-${Date.now()}`;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.jobLock.deleteMany({ where: { name: { startsWith: 'test-' } } });
    await prisma.$disconnect();
  });

  it('laisse passer un seul détenteur à la fois', async () => {
    let dedans = 0;
    let simultanéité = 0;

    const travail = async () => {
      dedans += 1;
      simultanéité = Math.max(simultanéité, dedans);
      await new Promise((r) => setTimeout(r, 50));
      dedans -= 1;
      return 'fait';
    };

    const [a, b] = await Promise.all([
      premier.withLock(nom, 30_000, travail),
      second.withLock(nom, 30_000, travail),
    ]);

    // L'un travaille, l'autre repart sans attendre : un travail périodique
    // qui trouve porte close n'a pas à faire la queue.
    expect([a, b].filter((r) => r === 'fait')).toHaveLength(1);
    expect([a, b].filter((r) => r === null)).toHaveLength(1);
    expect(simultanéité).toBe(1);
  });

  it('libère le verrou même quand le travail échoue', async () => {
    // Le garder ne protégerait rien et retarderait la reprise d'autant.
    await expect(
      premier.withLock(nom, 30_000, async () => {
        throw new Error('travail en échec');
      }),
    ).rejects.toThrow('travail en échec');

    const repris = await second.withLock(nom, 30_000, async () => 'libre');
    expect(repris).toBe('libre');
  });

  it("reprend un verrou expiré, pour qu'un processus tué ne bloque pas le parc", async () => {
    // Prise avec une durée de vie déjà écoulée : c'est l'état que laisse un
    // processus arrêté au milieu de son travail.
    await prisma.jobLock.upsert({
      where: { name: nom },
      create: { name: nom, holder: 'processus-disparu', lockedUntil: new Date(Date.now() - 1000) },
      update: { holder: 'processus-disparu', lockedUntil: new Date(Date.now() - 1000) },
    });

    expect(await second.withLock(nom, 30_000, async () => 'repris')).toBe('repris');
  });

  it("ne libère pas le verrou d'un autre", async () => {
    let relâchéParErreur = false;

    await premier.withLock(nom, 30_000, async () => {
      // Pendant que le premier travaille, le second tente sa chance et
      // repart bredouille — sans toucher au verrou en place.
      const refusé = await second.withLock(nom, 30_000, async () => 'ne devrait pas arriver');
      expect(refusé).toBeNull();

      const verrou = await prisma.jobLock.findUniqueOrThrow({ where: { name: nom } });
      relâchéParErreur = verrou.lockedUntil.getTime() <= Date.now();
    });

    expect(relâchéParErreur).toBe(false);
  });
});
