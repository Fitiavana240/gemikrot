import { describe, expect, it, vi } from 'vitest';
import { PurgeJobService } from './purge-job.service.js';

/**
 * La rétention des tickets expirés.
 *
 * Trente jours, décidés par l'exploitant, comptés depuis le **constat**
 * d'expiration et non depuis l'échéance. Ces tests figent le `where`, parce
 * qu'une purge qui déborde efface des ventes et qu'on ne s'en aperçoit
 * qu'après.
 */
function service() {
  const compteur = { count: 0 };
  const deleteMany = vi.fn(async () => compteur);
  const prisma = {
    userCacheEntry: { deleteMany },
    sessionCacheEntry: { deleteMany },
    statsCacheEntry: { deleteMany },
    paymentClaim: { deleteMany },
    auditLog: { deleteMany },
    routerOperation: { deleteMany },
    voucher: { deleteMany: vi.fn(async () => ({ count: 3 })) },
  };
  return { prisma, svc: new PurgeJobService(prisma as never) };
}

describe('PurgeJobService — tickets expirés', () => {
  it('n’efface que les tickets expirés, jamais ceux encore à vendre', async () => {
    const { prisma, svc } = service();

    await svc.run();

    const où = prisma.voucher.deleteMany.mock.calls[0]![0].where;
    expect(où.status).toBe('EXPIRED');
  });

  it('exige une date de constat, et l’exige ancienne de trente jours', async () => {
    // `expiredAt` nul écarte d'office tout ce qui n'a jamais été constaté
    // expiré ; sans cette condition, un ticket au statut hérité partirait
    // sans que personne n'ait jamais vu son échéance.
    const { prisma, svc } = service();
    const avant = Date.now();

    await svc.run();

    const où = prisma.voucher.deleteMany.mock.calls[0]![0].where;
    expect(où.expiredAt.not).toBeNull();
    const seuil = où.expiredAt.lt as Date;
    const jours = (avant - seuil.getTime()) / 86_400_000;
    expect(jours).toBeGreaterThanOrEqual(29.9);
    expect(jours).toBeLessThanOrEqual(30.1);
  });

  it('compte les tickets effacés dans son rapport', async () => {
    // Sans le chiffre, une purge qui emporte trop passe inaperçue.
    const { svc } = service();

    await expect(svc.run()).resolves.toMatchObject({ vouchers: 3 });
  });
});
