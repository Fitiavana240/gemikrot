import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoucherReconciliationService } from './voucher-reconciliation.service.js';

/**
 * Un ticket que la base croit vendable sans qu'aucun compte ne le porte est le
 * pire résultat commercial possible : le client a payé, son code n'ouvre rien,
 * et la liste affiche « vendu ».
 *
 * La réconciliation les rencontrait et passait au suivant — `continue`, sans
 * un mot. Pire, ceux qui n'avaient jamais été provisionnés n'étaient même pas
 * candidats : le filtre exigeait un `umUsername`, que ces tickets-là n'ont
 * justement pas.
 */
function fauxRouteur(options: { attributions?: unknown[]; comptesHotspot?: string[] } = {}) {
  return {
    getUserManagerUserProfiles: vi.fn(async () => options.attributions ?? []),
    getClock: vi.fn(async () => ({ gmtOffset: '+03:00' })),
    getHotspotUsers: vi.fn(async () => (options.comptesHotspot ?? []).map((username) => ({ username }))),
  };
}

function fauxPrisma(tickets: unknown[]) {
  const voucher = { findMany: vi.fn(async () => tickets), update: vi.fn(async () => ({})) };
  return { scopedStrict: { voucher } } as never;
}

function service(prisma: unknown, routeur: unknown) {
  return new VoucherReconciliationService(
    prisma as never,
    { forDefaultRouter: async () => routeur, getDefaultRouterId: async () => 'r1' } as never,
    { revoke: vi.fn(async () => ({ cookiesRemoved: 0, sessionsClosed: 0 })) } as never,
    { enqueue: vi.fn(async () => undefined) } as never,
  );
}

describe('VoucherReconciliationService — tickets sans compte', () => {
  let routeur: ReturnType<typeof fauxRouteur>;

  beforeEach(() => {
    routeur = fauxRouteur();
  });

  it('nomme un ticket User Manager dont le compte a disparu du routeur', async () => {
    const prisma = fauxPrisma([
      { id: '1', code: 'AAA111', umUsername: 'AAA111', target: 'USER_MANAGER', status: 'SOLD', expiresAt: null },
    ]);

    const rapport = await service(prisma, routeur).reconcileTenant();

    expect(rapport.sansCompte).toEqual(['AAA111']);
  });

  it("nomme un ticket qui n'a jamais été posé sur le routeur", async () => {
    // Ni compte User Manager, ni cible : ce ticket existe en base et nulle
    // part ailleurs. L'ancien filtre l'excluait du contrôle censé le trouver.
    const prisma = fauxPrisma([
      { id: '2', code: 'BBB222', umUsername: null, target: null, status: 'SOLD', expiresAt: null },
    ]);

    const rapport = await service(prisma, routeur).reconcileTenant();

    expect(rapport.sansCompte).toEqual(['BBB222']);
  });

  it('cherche un ticket HotSpot dans la bonne table', async () => {
    // Son compte porte le code et vit dans la table du HotSpot, pas dans User
    // Manager. Ne lire que les attributions revenait à le déclarer absent.
    const prisma = fauxPrisma([
      { id: '3', code: 'CCC333', umUsername: null, target: 'HOTSPOT', status: 'CREATED', expiresAt: null },
    ]);
    const avecCompte = fauxRouteur({ comptesHotspot: ['CCC333'] });

    expect((await service(prisma, avecCompte).reconcileTenant()).sansCompte).toEqual([]);
    expect((await service(prisma, routeur).reconcileTenant()).sansCompte).toEqual(['CCC333']);
  });

  it('ne signale rien quand le compte existe', async () => {
    const prisma = fauxPrisma([
      { id: '4', code: 'DDD444', umUsername: 'DDD444', target: 'USER_MANAGER', status: 'SOLD', expiresAt: null },
    ]);
    const avecAttribution = fauxRouteur({
      attributions: [{ username: 'DDD444', state: 'waiting', endTime: null }],
    });

    const rapport = await service(prisma, avecAttribution).reconcileTenant();

    expect(rapport.sansCompte).toEqual([]);
  });

  it('rend une liste vide plutôt que rien quand il n’y a aucun ticket', async () => {
    // Le raccourci « aucun candidat » sautait la construction du rapport :
    // l'écran lisait `undefined` et n'affichait ni zéro ni rien de sûr.
    const rapport = await service(fauxPrisma([]), routeur).reconcileTenant();

    expect(rapport.sansCompte).toEqual([]);
    expect(rapport.examined).toBe(0);
  });
});
