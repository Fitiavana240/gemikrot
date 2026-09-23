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

/**
 * La cloche de la plateforme.
 *
 * Elle rendait **toujours** une liste vide : le SUPER_ADMIN n'a pas
 * d'exploitant, et la branche << pas d'exploitant >> s'arretait la. Une
 * inscription est ainsi restee une journee entiere sans atteindre personne.
 * Une cloche qui ne sonne jamais n'est pas silencieuse, elle est cassee.
 */
function plateforme(
  etat: {
    enAttente?: { name: string; createdAt: Date }[];
    essaisQuiFinissent?: number;
    expires?: number;
    sansRouteur?: number;
    lues?: string[];
  } = {},
) {
  const prisma: any = {
    tenant: {
      findMany: vi.fn(async () => etat.enAttente ?? []),
      count: vi
        .fn()
        .mockResolvedValueOnce(etat.essaisQuiFinissent ?? 0)
        .mockResolvedValueOnce(etat.expires ?? 0)
        .mockResolvedValueOnce(etat.sansRouteur ?? 0),
    },
    notificationLue: {
      findMany: vi.fn(async () => (etat.lues ?? []).map((cle) => ({ cle }))),
      upsert: vi.fn(async () => ({})),
    },
  };
  return new NotificationsService(
    prisma,
    // Aucun exploitant cible : c'est le cas ordinaire du SUPER_ADMIN.
    { get: () => undefined } as never,
    { get: () => 'true' } as never,
  );
}

describe('la cloche de la plateforme', () => {
  it('ne rend toujours rien a un compte sans exploitant qui n’est pas SUPER_ADMIN', async () => {
    // Un ADMIN sans exploitant ne devrait pas exister ; s'il existe, il n'a
    // rien a surveiller et surtout rien a savoir de la plateforme.
    const liste = await plateforme({
      enAttente: [{ name: 'Test Wifi', createdAt: new Date() }],
    }).lister('admin-1');

    expect(liste).toEqual([]);
  });

  it('signale une inscription qui attend depuis la veille', async () => {
    // Le cas exact de cette installation : un compte inscrit hier, toujours
    // en attente, et personne ne le savait.
    const liste = await plateforme({
      enAttente: [{ name: 'Test Wifi', createdAt: new Date(Date.now() - 1.5 * JOUR) }],
    }).lister('admin-1', 'SUPER_ADMIN');

    const n = liste.find((x) => x.cle.startsWith('exploitants-en-attente'));
    expect(n?.gravite).toBe('urgent');
    expect(n?.detail).toMatch(/Test Wifi/);
    expect(n?.detail).toMatch(/1 jour/);
    expect(n?.lien).toBe('/tenants');
  });

  it('reste une attention le jour meme de l’inscription', async () => {
    const liste = await plateforme({
      enAttente: [{ name: 'Neuf', createdAt: new Date() }],
    }).lister('admin-1', 'SUPER_ADMIN');

    expect(liste[0].gravite).toBe('attention');
  });

  it('annonce les essais qui se terminent, seul moment pour convertir', async () => {
    const liste = await plateforme({ essaisQuiFinissent: 2 }).lister('admin-1', 'SUPER_ADMIN');

    const n = liste.find((x) => x.cle.startsWith('essais-qui-finissent'));
    expect(n?.titre).toMatch(/2 essai/);
  });

  it('dit ce qui n’arrive pas quand un abonnement expire', async () => {
    // Sans cette phrase, on croit avoir coupe le Wi-Fi de quelqu'un.
    const liste = await plateforme({ expires: 1 }).lister('admin-1', 'SUPER_ADMIN');

    const n = liste.find((x) => x.cle.startsWith('abonnements-expires'));
    expect(n?.gravite).toBe('urgent');
    expect(n?.detail).toMatch(/gardent leur acces|gardent leur accès/);
  });

  it('se tait quand la plateforme n’a rien a decider', async () => {
    expect(await plateforme().lister('admin-1', 'SUPER_ADMIN')).toEqual([]);
  });

  it('retient ce qui a ete ecarte', async () => {
    const liste = await plateforme({
      expires: 1,
      lues: ['abonnements-expires:1'],
    }).lister('admin-1', 'SUPER_ADMIN');

    expect(liste[0].lue).toBe(true);
  });
});
