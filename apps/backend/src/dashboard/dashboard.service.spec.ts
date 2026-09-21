import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from './dashboard.service.js';

/**
 * L'état de l'ordonnanceur, rendu au tableau de bord.
 *
 * Constaté sur cette installation : `SCHEDULER_ENABLED` est absent du `.env`,
 * donc rien n'expire tout seul — ni les tickets échus, ni la coupure des
 * accès, ni la suspension des abonnés hors tolérance. Aucun écran ne le
 * disait, alors que tous parlent d'échéances : « Échéances sous 7 jours »
 * n'est un compte à rebours que si quelque chose agit à l'échéance.
 */
function service(
  schedulerEnabled: string | undefined,
  comptes: { clients?: number; injoignables?: number } = {},
) {
  const vide = vi.fn(async () => []);
  const prisma = {
    scoped: {
      voucher: { groupBy: vide, count: vi.fn(async () => 0) },
      payment: {
        groupBy: vide,
        findMany: vide,
        count: vi.fn(async () => 0),
        findFirst: vi.fn(async () => null),
        aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })),
      },
      customer: {
        findMany: vide,
        // Le total d'abord, les injoignables ensuite : c'est l'ordre des deux
        // appels dans le service, et l'inverser ferait passer le test en
        // annonçant les mauvais chiffres.
        count: vi
          .fn()
          .mockResolvedValueOnce(comptes.clients ?? 0)
          .mockResolvedValueOnce(comptes.injoignables ?? 0),
      },
      subscription: { count: vi.fn(async () => 0) },
    },
  };
  const clients = { forDefaultRouter: vi.fn(async () => ({ getHotspotActiveUsers: vide })) };
  const config = { get: vi.fn(() => schedulerEnabled) };
  return new DashboardService(prisma as never, clients as never, config as never);
}

describe('DashboardService.getSummary — clients', () => {
  it('rend le total et ce qu’il cache', async () => {
    // Le tableau de bord montrait les dix derniers clients sans jamais dire
    // combien il y en a — une liste de dix noms se lit pareil qu'on en ait
    // douze ou six cents.
    const r = await service('true', { clients: 618, injoignables: 594 }).getSummary();

    expect(r.clients).toBe(618);
    // Le routeur ne stocke aucun téléphone : une fiche importée porte un
    // numéro provisoire qui ressemble à un vrai. Sans ce second nombre,
    // « prévenir les échéances » resterait une promesse invérifiable.
    expect(r.clientsInjoignables).toBe(594);
  });
});

describe('DashboardService.getSummary — ordonnanceur', () => {
  it('dit faux quand la variable est absente', async () => {
    // Le cas de cette installation, et le plus dangereux : rien ne tourne, et
    // rien ne le signalait.
    const r = await service(undefined).getSummary();

    expect(r.ordonnanceurActif).toBe(false);
  });

  it('dit vrai pour la chaîne « true », et pour elle seule', async () => {
    // Même expression que `SchedulerService`, délibérément : si l'un acceptait
    // « 1 » ou « yes » et l'autre non, l'écran mentirait dans un sens ou dans
    // l'autre.
    expect((await service('true').getSummary()).ordonnanceurActif).toBe(true);
    expect((await service('1').getSummary()).ordonnanceurActif).toBe(false);
    expect((await service('yes').getSummary()).ordonnanceurActif).toBe(false);
    expect((await service('TRUE').getSummary()).ordonnanceurActif).toBe(false);
  });
});
