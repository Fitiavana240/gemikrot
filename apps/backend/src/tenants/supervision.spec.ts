import { describe, expect, it, vi } from 'vitest';
import { SupervisionService } from './supervision.service.js';

/**
 * SAS-4 : la plateforme vue d'en haut.
 *
 * Ce qui compte n'est pas le tableau, ce sont les trois phrases au-dessus :
 * un exploitant dont tous les routeurs sont muets ne vend plus rien, un
 * abonnement échu est de l'argent que la plateforme n'encaisse pas, et un
 * exploitant actif sans routeur n'a jamais fini son installation. Les trois
 * se lisent d'un coup d'œil, ou ne se lisent jamais.
 */

const MINUTE = 60_000;

function service(tenants: unknown[], recettes: unknown[] = [], attentes: unknown[] = []) {
  const prisma: any = {
    tenant: { findMany: vi.fn(async () => tenants) },
    payment: {
      groupBy: vi.fn().mockResolvedValueOnce(recettes).mockResolvedValueOnce(attentes),
    },
  };
  return new SupervisionService(prisma);
}

/** Un exploitant ordinaire : actif, un routeur qui vient de répondre. */
const exploitant = (extra: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'Zone WIFI-TATI',
  wifiName: 'WIFI-TATI',
  status: 'ACTIVE',
  currency: 'MGA',
  platformEndsAt: null,
  platformGraceEndsAt: null,
  routers: [{ id: 'r1', status: 'online', lastSeenAt: new Date() }],
  _count: { customers: 16 },
  ...extra,
});

describe('l’état des routeurs', () => {
  it('compte joignable celui qui vient de répondre', async () => {
    const { totaux } = await service([exploitant()]).apercu();

    expect(totaux.routeursJoignables).toBe(1);
    expect(totaux.routeurs).toBe(1);
  });

  it('ne croit pas une colonne figée sur un routeur muet depuis une heure', async () => {
    // `status` garde la valeur du dernier contact réussi, et dans le
    // vocabulaire de la base (`online`) : un routeur débranché y resterait
    // « en ligne » pour toujours. C'est la date qui tranche, et elle seule.
    const { totaux, alertes } = await service([
      exploitant({
        routers: [{ id: 'r1', status: 'online', lastSeenAt: new Date(Date.now() - 60 * MINUTE) }],
      }),
    ]).apercu();

    expect(totaux.routeursJoignables).toBe(0);
    expect(alertes.join(' ')).toMatch(/plus aucun routeur joignable/);
  });

  it('ne reproche rien à un exploitant suspendu', async () => {
    // Il ne vend pas, et c'est voulu : le signaler chaque minute noierait les
    // alertes qui demandent vraiment quelque chose.
    const { alertes } = await service([
      exploitant({ status: 'SUSPENDED', routers: [{ id: 'r1', status: 'unreachable', lastSeenAt: null }] }),
    ]).apercu();

    expect(alertes).toEqual([]);
  });
});

describe('les alertes de la plateforme', () => {
  it('signale un abonnement expiré', async () => {
    const { alertes } = await service([
      exploitant({
        platformEndsAt: new Date(Date.now() - 60 * 86_400_000),
        platformGraceEndsAt: new Date(Date.now() - 45 * 86_400_000),
      }),
    ]).apercu();

    expect(alertes.join(' ')).toMatch(/expiré/);
  });

  it('signale un exploitant actif qui n’a jamais raccordé de routeur', async () => {
    // Sa mise en route n'est pas terminée, et personne ne le saurait : il
    // n'apparaît dans aucune panne, puisqu'il n'a rien qui puisse tomber.
    const { alertes } = await service([exploitant({ routers: [] })]).apercu();

    expect(alertes.join(' ')).toMatch(/sans aucun routeur raccordé/);
  });

  it('ne dit rien quand tout va bien', async () => {
    const { alertes } = await service([exploitant()]).apercu();

    expect(alertes).toEqual([]);
  });
});

describe('les chiffres', () => {
  it('rattache recette et attentes au bon exploitant', async () => {
    // Deux agrégats pour tous plutôt qu'une requête par exploitant : vingt
    // exploitants feraient quarante allers-retours.
    const { exploitants } = await service(
      [exploitant(), exploitant({ id: 't2', name: 'Autre' })],
      [{ tenantId: 't2', _sum: { amount: 125000 } }],
      [{ tenantId: 't1', _count: { _all: 3 } }],
    ).apercu();

    expect(exploitants.find((e) => e.id === 't1')?.recette30j).toBe('0');
    expect(exploitants.find((e) => e.id === 't1')?.paiementsEnAttente).toBe(3);
    expect(exploitants.find((e) => e.id === 't2')?.recette30j).toBe('125000');
    expect(exploitants.find((e) => e.id === 't2')?.paiementsEnAttente).toBe(0);
  });

  it('retient le contact le plus récent parmi plusieurs routeurs', async () => {
    const recent = new Date(Date.now() - 5 * MINUTE);
    const { exploitants } = await service([
      exploitant({
        routers: [
          { id: 'r1', status: 'online', lastSeenAt: new Date(Date.now() - 300 * MINUTE) },
          { id: 'r2', status: 'online', lastSeenAt: recent },
        ],
      }),
    ]).apercu();

    expect(exploitants[0].dernierContact).toEqual(recent);
  });
});
