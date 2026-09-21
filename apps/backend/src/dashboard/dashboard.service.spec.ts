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
function service(schedulerEnabled: string | undefined) {
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
      customer: { findMany: vide },
      subscription: { count: vi.fn(async () => 0) },
    },
  };
  const clients = { forDefaultRouter: vi.fn(async () => ({ getHotspotActiveUsers: vide })) };
  const config = { get: vi.fn(() => schedulerEnabled) };
  return new DashboardService(prisma as never, clients as never, config as never);
}

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
