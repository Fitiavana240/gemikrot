import { describe, expect, it, vi } from 'vitest';
import { AbonnementPlateformeService, etatDe } from './abonnement-plateforme.service.js';

const jours = (n: number) => new Date(Date.now() + n * 86_400_000);

describe('etatDe', () => {
  it('ne bloque rien sans échéance', () => {
    // C'est le cas de tout exploitant qui n'a pas encore de contrat. Un
    // champ resté vide ne doit jamais fermer une console.
    expect(etatDe(null, null)).toEqual({ etat: 'sans-abonnement', joursRestants: null });
  });

  it('compte les jours restants avant l’échéance', () => {
    const { etat, joursRestants } = etatDe(jours(10), jours(24));

    expect(etat).toBe('a-jour');
    expect(joursRestants).toBe(10);
  });

  it('laisse la tolérance courir après l’échéance', () => {
    // Une console qui se ferme le jour même d'un retard de virement ferait
    // perdre des ventes pour rien.
    const { etat, joursRestants } = etatDe(jours(-3), jours(11));

    expect(etat).toBe('en-tolerance');
    expect(joursRestants).toBe(11);
  });

  it('bloque une fois la tolérance passée', () => {
    expect(etatDe(jours(-30), jours(-16)).etat).toBe('expire');
  });

  it('déduit une tolérance de quinze jours quand elle n’est pas posée', () => {
    // Une ligne d'avant l'ajout du champ ne doit pas se retrouver bloquée le
    // lendemain de son échéance faute de tolérance enregistrée.
    expect(etatDe(jours(-5), null).etat).toBe('en-tolerance');
    expect(etatDe(jours(-20), null).etat).toBe('expire');
  });

  it('traite l’échéance du jour comme encore à jour', () => {
    // La borne se joue sur une seconde : la franchir dans le mauvais sens
    // couperait la vente le matin du jour payé.
    const dansUneHeure = new Date(Date.now() + 3_600_000);

    expect(etatDe(dansUneHeure, null).etat).toBe('a-jour');
  });
});

/**
 * L'essai gratuit et la souscription.
 *
 * Trois regles decident de l'argent, et ce sont elles qu'on eprouve : l'essai
 * ne s'ouvre qu'une fois, il ne traine pas de tolerance derriere lui, et le
 * plafond d'un routeur qu'il pose ne survit pas a une vraie souscription.
 */

function service(tenant: Record<string, unknown> | null) {
  const update = vi.fn(async (args: any) => ({ id: 't1', ...args.data }));
  const prisma: any = {
    tenant: { findUnique: vi.fn(async () => tenant), update },
    router: { count: vi.fn(async () => 2) },
  };
  const s = new AbonnementPlateformeService(
    prisma,
    { requireTenantId: () => 't1' } as never,
    { log: vi.fn(async () => undefined) } as never,
  );
  return { service: s, update, prisma };
}

describe('l’essai gratuit', () => {
  it('pose cinq jours sans tolerance, et un seul routeur', async () => {
    const { service: s, update } = service({ platformEndsAt: null });

    await expect(s.demarrerEssai('t1')).resolves.toBe(true);

    const data = update.mock.calls[0][0].data;
    expect(data.maxRouters).toBe(1);
    // Fin de tolerance = echeance : cinq jours plus quatorze feraient
    // dix-neuf jours gratuits.
    expect(data.platformGraceEndsAt.getTime()).toBe(data.platformEndsAt.getTime());
    const jours = Math.round(
      (data.platformEndsAt.getTime() - Date.now()) / 86_400_000,
    );
    expect(jours).toBe(5);
  });

  it('ne se rouvre pas sur un compte qui a deja eu une echeance', async () => {
    // Sinon il suffirait de se faire suspendre puis reactiver pour obtenir un
    // second essai, indefiniment.
    const { service: s, update } = service({ platformEndsAt: new Date() });

    await expect(s.demarrerEssai('t1')).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('la souscription', () => {
  it('leve le plafond de l’essai quand on paie', async () => {
    // L'exploitant qui regle et reste coince a un routeur ne comprendrait
    // pas ce qu'il vient d'acheter.
    const { service: s, update } = service({ platformEndsAt: null, maxRouters: 1 });

    await s.souscrire('t1', 'MENSUEL', 'admin');

    expect(update.mock.calls[0][0].data.maxRouters).toBeNull();
  });

  it('refuse de vendre l’essai', async () => {
    const { service: s } = service({ platformEndsAt: null });

    await expect(s.souscrire('t1', 'ESSAI', 'admin')).rejects.toThrow(/essai/i);
  });

  it('refuse un code inconnu en nommant les codes valides', async () => {
    const { service: s } = service({ platformEndsAt: null });

    await expect(s.souscrire('t1', 'TRIMESTRIEL', 'admin')).rejects.toThrow(/MENSUEL/);
  });

  it('pose la tolerance de l’offre apres la nouvelle echeance', async () => {
    const { service: s, update } = service({ platformEndsAt: null });

    await s.souscrire('t1', 'ANNUEL', 'admin');

    const data = update.mock.calls[0][0].data;
    const ecart = Math.round(
      (data.platformGraceEndsAt.getTime() - data.platformEndsAt.getTime()) / 86_400_000,
    );
    expect(ecart).toBe(14);
  });
});

describe('ce que l’exploitant lit', () => {
  it('chiffre le renouvellement sur son parc reel', async () => {
    const { service: s } = service({
      platformPlanName: 'Mensuel',
      maxRouters: null,
      platformEndsAt: jours(10),
      platformGraceEndsAt: jours(24),
      currency: 'MGA',
    });

    const etat = await s.etat('t1');

    expect(etat.offreCode).toBe('MENSUEL');
    // Deux routeurs comptes plus haut, a 7 000 Ar piece.
    expect(etat.montantDu).toBe(14_000);
    expect(etat.periode).toBe('mois');
  });

  it('n’invente aucun montant pour une offre ecrite a la main', async () => {
    const { service: s } = service({
      platformPlanName: 'Arrangement de juillet',
      maxRouters: null,
      platformEndsAt: jours(10),
      platformGraceEndsAt: jours(24),
      currency: 'MGA',
    });

    const etat = await s.etat('t1');

    expect(etat.offre).toBe('Arrangement de juillet');
    expect(etat.offreCode).toBeNull();
    expect(etat.montantDu).toBeNull();
  });
});
