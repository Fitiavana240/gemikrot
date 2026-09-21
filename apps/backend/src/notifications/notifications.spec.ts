import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service.js';

/**
 * Ce qui demande une décision, rassemblé sous une cloche.
 *
 * Rien n'est stocké : les notifications se recalculent à chaque lecture. Une
 * table vieillirait — on lirait « paiement en attente » sur un paiement
 * validé la veille — et demanderait une tâche de fond qui n'existe pas.
 */

const JOUR = 86_400_000;

function service(
  etat: {
    enAttente?: number;
    plusAncienJours?: number;
    echeances?: number;
    injoignables?: number;
    puces?: number;
    prixARevoir?: number;
    tickets?: number;
    finAbonnement?: Date | null;
    lues?: string[];
    /** `true` reproduit ce parc : la variable est absente du `.env`. */
    ordonnanceurEteint?: boolean;
  } = {},
) {
  const compteur = (n: number) => vi.fn(async () => n);
  const prisma: any = {
    scoped: {
      payment: {
        count: compteur(etat.enAttente ?? 0),
        findFirst: vi.fn(async () =>
          etat.plusAncienJours === undefined
            ? null
            : { createdAt: new Date(Date.now() - etat.plusAncienJours * JOUR) },
        ),
      },
      subscription: {
        count: vi
          .fn()
          .mockResolvedValueOnce(etat.echeances ?? 0)
          .mockResolvedValueOnce(etat.injoignables ?? 0),
      },
      mobileMoneyAccount: { count: compteur(etat.puces ?? 1) },
      plan: { count: compteur(etat.prixARevoir ?? 0) },
      voucher: { count: compteur(etat.tickets ?? 5) },
    },
    tenant: {
      findUnique: vi.fn(async () => ({
        platformEndsAt: etat.finAbonnement ?? null,
        platformGraceEndsAt: null,
      })),
    },
    notificationLue: {
      findMany: vi.fn(async () => (etat.lues ?? []).map((cle) => ({ cle }))),
      upsert: vi.fn(async () => ({})),
    },
  };

  return new NotificationsService(
    prisma,
    { get: () => ({ tenantId: 't1' }) } as never,
    { get: () => (etat.ordonnanceurEteint ? undefined : 'true') } as never,
  );
}

describe('la cloche', () => {
  it('ne dit rien quand rien ne demande de décision', async () => {
    // Une pastille qui ne retombe jamais à zéro cesse d'être lue, et c'est
    // précisément la semaine où quelque chose arrive.
    const liste = await service().lister('admin-1');

    expect(liste).toEqual([]);
  });

  it('rend urgent un paiement qui attend depuis deux jours', async () => {
    // Ce client a payé et n'a rien reçu. Il ne rappellera pas : il conclura
    // que ça ne marche pas.
    const liste = await service({ enAttente: 3, plusAncienJours: 3 }).lister('admin-1');

    const n = liste.find((x) => x.cle.startsWith('paiements-en-attente'));
    expect(n?.gravite).toBe('urgent');
    expect(n?.detail).toMatch(/3 jour/);
    expect(n?.lien).toBe('/payments');
  });

  it('reste une simple attention le jour même', async () => {
    const liste = await service({ enAttente: 1, plusAncienJours: 0 }).lister('admin-1');

    expect(liste.find((x) => x.cle.startsWith('paiements'))?.gravite).toBe('attention');
  });

  it('signale l’absence de puce comme urgente', async () => {
    // La page de paiement montre les prix, puis un écran sans numéro.
    const liste = await service({ puces: 0 }).lister('admin-1');

    expect(liste.find((x) => x.cle === 'aucune-puce')?.gravite).toBe('urgent');
  });

  it('dit combien d’échéances sont injoignables', async () => {
    const liste = await service({ echeances: 12, injoignables: 10 }).lister('admin-1');

    expect(liste.find((x) => x.cle.startsWith('echeances'))?.detail).toMatch(/10 sans numéro/);
  });

  it('marque lue celle qui a été écartée', async () => {
    const liste = await service({ puces: 0, lues: ['aucune-puce'] }).lister('admin-1');

    expect(liste.find((x) => x.cle === 'aucune-puce')?.lue).toBe(true);
  });

  it('ne laisse pas un écart écarté enterrer ce qui s’aggrave', async () => {
    // La clef porte le compte : avoir vu « 3 paiements » ne doit pas cacher
    // le cinquième, sinon écarter une fois rend la cloche muette pour
    // toujours sur ce sujet.
    const liste = await service({
      enAttente: 5,
      plusAncienJours: 1,
      lues: ['paiements-en-attente:3'],
    }).lister('admin-1');

    expect(liste.find((x) => x.cle === 'paiements-en-attente:5')?.lue).toBe(false);
  });

  it('dit que rien n’expire tout seul quand l’ordonnanceur est éteint', async () => {
    const liste = await service({ ordonnanceurEteint: true }).lister('admin-1');

    expect(liste.find((x) => x.cle === 'ordonnanceur-eteint')).toBeDefined();
  });

  it('rappelle que les clients gardent leur accès quand la plateforme est échue', async () => {
    // Sans cette phrase, un exploitant en retard croit son réseau coupé et
    // appelle ses clients pour rien.
    const liste = await service({ finAbonnement: new Date(Date.now() - 60 * JOUR) }).lister(
      'admin-1',
    );

    const n = liste.find((x) => x.cle.startsWith('abonnement-plateforme'));
    expect(n?.gravite).toBe('urgent');
    expect(n?.detail).toMatch(/gardent leur accès/);
  });
});

describe('sans exploitant ciblé', () => {
  it('rend une liste vide plutôt que d’échouer', async () => {
    // Le SUPER_ADMIN qui ne cible personne n'a pas d'exploitant à
    // surveiller ; faire échouer sa barre pour autant serait absurde.
    const s = new NotificationsService(
      {} as never,
      { get: () => undefined } as never,
      { get: () => 'true' } as never,
    );

    expect(await s.lister('admin-1')).toEqual([]);
  });
});
