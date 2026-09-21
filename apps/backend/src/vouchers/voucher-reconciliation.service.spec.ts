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

/**
 * Un ticket HotSpot arrive au bout de son plafond de durée.
 *
 * Ce contrôle ne vérifiait que l'existence du compte : « son profil ne porte
 * pas d'échéance ». C'est vrai, mais il porte un `limit-uptime`, et l'épuiser
 * est bel et bien une expiration — RouterOS refuse le compte au-delà. Relevé
 * sur le parc : des comptes à 2 h consommées sur 2 h, épuisés depuis des
 * jours, qu'aucune règle ne déclarait expirés.
 */
function compteHotspot(champs: {
  username: string;
  uptimeSeconds?: number;
  limitUptimeSeconds?: number | null;
  disabled?: boolean;
}) {
  return {
    username: champs.username,
    uptimeSeconds: champs.uptimeSeconds ?? 0,
    limitUptimeSeconds: champs.limitUptimeSeconds ?? null,
    disabled: champs.disabled ?? false,
  };
}

function routeurAvecComptes(comptes: ReturnType<typeof compteHotspot>[]) {
  return {
    getUserManagerUserProfiles: vi.fn(async () => []),
    getClock: vi.fn(async () => ({ gmtOffset: '+03:00' })),
    getHotspotUsers: vi.fn(async () => comptes),
  };
}

const ticketHotspot = (code: string, status = 'SOLD') => ({
  id: `v-${code}`,
  code,
  umUsername: null,
  target: 'HOTSPOT',
  status,
  expiresAt: null,
});

describe('VoucherReconciliationService — plafond de durée HotSpot', () => {
  it('déclare expiré un ticket dont le plafond est atteint', async () => {
    const prisma = fauxPrisma([ticketHotspot('H762565')]);
    const routeur = routeurAvecComptes([
      compteHotspot({ username: 'H762565', uptimeSeconds: 7200, limitUptimeSeconds: 7200 }),
    ]);

    const r = await service(prisma, routeur).reconcileTenant();

    expect(r.expired).toBe(1);
    expect((prisma as any).scopedStrict.voucher.update.mock.calls[0][0].data).toMatchObject({
      status: 'EXPIRED',
    });
  });

  it('ne touche pas à un ticket qui a encore du temps', async () => {
    const prisma = fauxPrisma([ticketHotspot('H776921')]);
    const routeur = routeurAvecComptes([
      compteHotspot({ username: 'H776921', uptimeSeconds: 4524, limitUptimeSeconds: 7200 }),
    ]);

    const r = await service(prisma, routeur).reconcileTenant();

    expect(r.expired).toBe(0);
    expect((prisma as any).scopedStrict.voucher.update).not.toHaveBeenCalled();
  });

  it('ne confond pas « bloqué » avec « expiré »', async () => {
    // Le X de WinBox veut dire bloqué : une décision d'exploitant, prise pour
    // une raison qui n'est pas l'épuisement. Sur ce parc, dix comptes sont
    // bloqués alors qu'il leur reste du temps — jusqu'à 1 h 34. Les déclarer
    // expirés effacerait la différence entre « le forfait est fini » et
    // « je l'ai coupé », et les trente jours de rétention partiraient sur un
    // ticket que l'exploitant voudra peut-être rouvrir.
    const prisma = fauxPrisma([ticketHotspot('H863057')]);
    const routeur = routeurAvecComptes([
      compteHotspot({
        username: 'H863057',
        uptimeSeconds: 1553,
        limitUptimeSeconds: 7200,
        disabled: true,
      }),
    ]);

    const r = await service(prisma, routeur).reconcileTenant();

    expect(r.expired).toBe(0);
    expect((prisma as any).scopedStrict.voucher.update).not.toHaveBeenCalled();
  });

  it('laisse tranquille un compte sans plafond de durée', async () => {
    // 228 comptes sont dans ce cas sur ce parc : sans plafond, rien ne permet
    // de dire qu'ils sont finis, si longue que soit leur consommation.
    const prisma = fauxPrisma([ticketHotspot('H718942')]);
    const routeur = routeurAvecComptes([
      compteHotspot({ username: 'H718942', uptimeSeconds: 99_999, limitUptimeSeconds: null }),
    ]);

    const r = await service(prisma, routeur).reconcileTenant();

    expect(r.expired).toBe(0);
  });

  it('ne repasse pas sur un ticket déjà marqué expiré', async () => {
    const prisma = fauxPrisma([ticketHotspot('H762565', 'EXPIRED')]);
    const routeur = routeurAvecComptes([
      compteHotspot({ username: 'H762565', uptimeSeconds: 7200, limitUptimeSeconds: 7200 }),
    ]);

    const r = await service(prisma, routeur).reconcileTenant();

    expect(r.expired).toBe(0);
  });
});
