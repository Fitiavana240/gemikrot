import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';
import { RoutersService } from './routers.service.js';
import { RoutersController } from './routers.controller.js';
import { WireguardService } from './wireguard.service.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';

/**
 * Le matériel d'un exploitant n'appartient qu'à lui.
 *
 * Le SUPER_ADMIN gère la plateforme : abonnements, comptes, fiches. Mais
 * **ouvrir une connexion vers le routeur d'un exploitant est d'une autre
 * nature** — c'est voir ses clients connectés, lire ses comptes HotSpot,
 * écrire dans sa configuration. Rien dans la gestion d'une plateforme ne
 * l'exige, et la possibilité seule suffit à rendre la promesse fausse.
 */

const ROUTEUR = {
  id: 'r1',
  label: 'hAP Betania',
  host: '10.88.0.2',
  restPort: 443,
  credentialsEncrypted: 'chiffre',
  tlsFingerprint: null,
  tunnelAddress: '10.88.0.2',
  tunnelPublicKey: 'cle-du-routeur',
  enrolledAt: new Date(),
} as never;

function fabrique(contexte: { tenantId: string | null; isSuperAdmin: boolean; priseEnMain?: boolean }) {
  const prisma = { scoped: { router: { findUnique: vi.fn(async () => ROUTEUR) } } } as never;
  return new MikrotikClientFactory(
    prisma,
    { decrypt: () => ({ username: 'gemikrot-api', password: 'x' }) } as never,
    { get: () => ({ state: 'INCONNU' }), reset: vi.fn() } as never,
    { get: () => contexte } as never,
  );
}

describe('la plateforme ne se connecte pas au routeur d’un exploitant', () => {
  it('refuse quand le SUPER_ADMIN agit au nom d’un exploitant', async () => {
    const factory = fabrique({ tenantId: 't1', isSuperAdmin: false, priseEnMain: true });

    await expect(factory.forRouter('r1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('dit ce qui reste permis, plutôt qu’un refus sec', async () => {
    // Un « accès refusé » sans suite laisse croire à une panne de droits. La
    // frontière est une décision de conception : elle doit s'énoncer.
    const factory = fabrique({ tenantId: 't1', isSuperAdmin: false, priseEnMain: true });

    await expect(factory.forRouter('r1')).rejects.toThrow(/abonnement et sa fiche, pas son mat/);
  });

  it('laisse passer l’exploitant lui-même', async () => {
    const factory = fabrique({ tenantId: 't1', isSuperAdmin: false });

    await expect(factory.forRouter('r1')).resolves.toBeDefined();
  });

  it('laisse passer les travaux de fond', async () => {
    // Hors requête HTTP — file d'opérations différées, réconciliation — il n'y
    // a personne derrière l'appel : `priseEnMain` est absent, et le travail
    // agit pour l'exploitant, pas pour quelqu'un. Les y bloquer arrêterait
    // l'expiration automatique des accès.
    const factory = fabrique({ tenantId: 't1', isSuperAdmin: false, priseEnMain: undefined });

    await expect(factory.forRouter('r1')).resolves.toBeDefined();
  });
});

/**
 * La suppression d'une fiche : facile quand elle ne porte rien, refusée sinon.
 *
 * Chaque essai de raccordement qui n'aboutit pas laisse une fiche à nettoyer,
 * et ce ménage doit être simple. Mais un routeur en service porte les
 * abonnements, les appareils et les lots de tickets d'un exploitant : les
 * emporter d'un clic serait irréversible et muet.
 */

function servicePourSuppression(attaches: Record<string, number>) {
  const compte = (modele: string) => vi.fn(async () => attaches[modele] ?? 0);
  const supprime = vi.fn(async () => ({}));
  const prisma = {
    scoped: { router: { findUnique: vi.fn(async () => ROUTEUR) } },
    subscription: { count: compte('abonnements') },
    device: { count: compte('appareils') },
    voucherBatch: { count: compte('lots') },
    routerOperation: { count: compte('operations'), deleteMany: supprime },
    routerEnrollment: { deleteMany: supprime },
    userCacheEntry: { deleteMany: supprime },
    sessionCacheEntry: { deleteMany: supprime },
    statsCacheEntry: { deleteMany: supprime },
    auditLog: { updateMany: supprime },
    router: { delete: supprime },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  } as never;

  const retraitDuPair = vi.fn(async () => undefined);
  const service = new RoutersService(
    prisma,
    {} as never,
    { invalidate: vi.fn() } as never,
    { log: vi.fn(async () => undefined) } as never,
    { get: () => ({ state: 'INCONNU' }) } as never,
    {} as never,
    {} as never,
    { removePeer: retraitDuPair } as never,
  );
  return { service, retraitDuPair, prisma };
}

describe('supprimer une fiche de routeur', () => {
  it('refuse tant que quelque chose y est attaché, et dit quoi', async () => {
    const { service } = servicePourSuppression({ abonnements: 12, appareils: 3 });

    await expect(service.supprimer('r1')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.supprimer('r1')).rejects.toThrow(/12 abonnements, 3 appareils/);
  });

  it('accorde le pluriel, parce qu’un message bancal fait douter du reste', async () => {
    const { service } = servicePourSuppression({ abonnements: 1 });

    await expect(service.supprimer('r1')).rejects.toThrow(/1 abonnement\b/);
  });

  it('supprime la fiche d’essai, qui ne porte rien', async () => {
    const { service } = servicePourSuppression({});

    await expect(service.supprimer('r1')).resolves.toEqual({ supprime: true });
  });

  it('retire le pair du tunnel avec la fiche', async () => {
    // Le laisser derrière garderait ouverte, dans le tunnel, une route vers un
    // routeur que la console ne connaît plus.
    const { service, retraitDuPair } = servicePourSuppression({});

    await service.supprimer('r1');

    expect(retraitDuPair).toHaveBeenCalledWith('cle-du-routeur');
  });
});

describe('qui peut supprimer', () => {
  it('le SUPER_ADMIN, et lui seul', () => {
    // C'est un geste irréversible sur du matériel en production : la personne
    // qui gère la plateforme est celle qui peut en mesurer la portée.
    const roles = Reflect.getMetadata(ROLES_KEY, RoutersController.prototype.supprimer);

    expect(roles).toEqual([AdminRole.SUPER_ADMIN]);
  });
});
