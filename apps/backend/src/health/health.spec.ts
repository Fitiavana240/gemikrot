import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service.js';
import { HealthController } from './health.controller.js';

/**
 * Le point de santé existe pour une seule raison : être cru.
 *
 * Ces épreuves fixent donc d'abord ce qu'il refuse de dire quand ça va mal —
 * un `200` sur une base tombée laisserait la surveillance verte pendant
 * exactement la panne qu'elle sert à voir — et ensuite ce qu'il ne dit pas
 * du tout à un inconnu.
 */

function service(options: {
  baseTombee?: boolean;
  migrations?: { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[];
  routeurs?: { status: string; lastSeenAt: Date | null }[];
} = {}) {
  const prisma: any = {
    // Les deux requêtes arrivent en gabarit balisé : le premier argument est
    // le tableau des morceaux de SQL. C'est lui qui les distingue.
    $queryRaw: vi.fn(async (morceaux: readonly string[]) => {
      if (options.baseTombee) throw new Error('connect ECONNREFUSED');
      const sql = Array.isArray(morceaux) ? morceaux.join(' ') : String(morceaux);
      if (sql.includes('_prisma_migrations')) return options.migrations ?? [];
      return [{ '?column?': 1 }];
    }),
    router: { findMany: vi.fn(async () => options.routeurs ?? []) },
  };
  return new HealthService(prisma);
}

describe('la base', () => {
  it('rend « degrade » quand elle ne répond pas', async () => {
    const sante = await service({ baseTombee: true }).resume();

    expect(sante.statut).toBe('degrade');
  });

  it('rend « ok » quand elle répond', async () => {
    const sante = await service().resume();

    expect(sante.statut).toBe('ok');
    expect(sante.demarreDepuisSecondes).toBeGreaterThanOrEqual(0);
  });
});

describe('le code HTTP porte le verdict', () => {
  it('refuse un 200 sur une base tombée', async () => {
    // Un moniteur lit d'abord le statut de la réponse. Rendre
    // `200 { statut: "degrade" }` ferait passer une panne pour un serveur en
    // forme, et la surveillance resterait verte pendant la panne.
    const controleur = new HealthController(service({ baseTombee: true }));

    await expect(controleur.resume()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rend le résumé quand tout va bien', async () => {
    const controleur = new HealthController(service());

    await expect(controleur.resume()).resolves.toMatchObject({ statut: 'ok' });
  });
});

describe('ce que le résumé ne dit pas', () => {
  it('ne renseigne pas un inconnu sur l’installation', async () => {
    // Ce point est ouvert — un moniteur n'a pas de session. Le nom des
    // migrations et le décompte des routeurs se lisent connecté.
    const sante = await service({
      migrations: [{ migration_name: '20260923_secrets', finished_at: new Date(), rolled_back_at: null }],
      routeurs: [{ status: 'online', lastSeenAt: new Date() }],
    }).resume();

    expect(Object.keys(sante).sort()).toEqual(['demarreDepuisSecondes', 'statut', 'version']);
  });
});

describe('une migration interrompue', () => {
  it('dégrade le détail, même si la base répond', async () => {
    // Une migration commencée et jamais terminée laisse une base à moitié
    // faite sur laquelle l'application démarre sans broncher : les écrans
    // marchent jusqu'au premier qui touche la colonne manquante, des heures
    // plus tard, et l'incident ne ressemble plus à un déploiement raté.
    const detail = await service({
      migrations: [
        { migration_name: '20260924_en_cours', finished_at: null, rolled_back_at: null },
        { migration_name: '20260923_secrets', finished_at: new Date(), rolled_back_at: null },
      ],
    }).detail();

    expect(detail.statut).toBe('degrade');
    expect(detail.migration.interrompue).toBe('20260924_en_cours');
    expect(detail.migration.derniere).toBe('20260923_secrets');
  });

  it('ne compte pas une migration annulée comme interrompue', async () => {
    const detail = await service({
      migrations: [
        { migration_name: '20260924_annulee', finished_at: null, rolled_back_at: new Date() },
        { migration_name: '20260923_secrets', finished_at: new Date(), rolled_back_at: null },
      ],
    }).detail();

    expect(detail.statut).toBe('ok');
    expect(detail.migration.interrompue).toBeNull();
  });
});

describe('les routeurs', () => {
  it('compte les raccordés et ceux qui donnent signe de vie', async () => {
    const vieux = new Date('2026-09-20T08:00:00Z');
    const detail = await service({
      routeurs: [
        { status: 'online', lastSeenAt: new Date('2026-09-24T08:00:00Z') },
        { status: 'unreachable', lastSeenAt: vieux },
        { status: 'enrolled', lastSeenAt: null },
      ],
    }).detail();

    expect(detail.routeurs.raccordes).toBe(3);
    expect(detail.routeurs.joignables).toBe(2);
    expect(detail.routeurs.plusVieuxContact).toEqual(vieux);
  });

  it('se lisent en base, et nulle part ailleurs', async () => {
    // Un `/health` relevé toutes les trente secondes qui composerait le parc
    // ferait de la surveillance la première cause de charge — et sur des
    // liaisons lentes, la première cause de panne. L'arité du constructeur
    // le dit mieux qu'un espion : le service ne connaît que la base, et
    // brancher un client MikroTik dessus casserait cette ligne.
    expect(HealthService.length).toBe(1);
  });
});
