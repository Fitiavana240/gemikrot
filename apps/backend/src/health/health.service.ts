import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * L'état du serveur, pour qui le surveille de l'extérieur.
 *
 * **Trois choses, et pas une de plus.** La base répond-elle, les migrations
 * sont-elles entières, les routeurs raccordés donnent-ils signe de vie. Ce
 * sont les trois pannes qui laissent le produit debout mais inutile : un
 * serveur qui répond « Hello World » pendant que la base est tombée trompe
 * exactement la surveillance censée l'attraper.
 *
 * **Rien n'est interrogé en direct.** Le point de santé lit l'état déjà
 * connu ; il ne compose aucun routeur. Un `/health` relevé toutes les trente
 * secondes qui appellerait le parc ferait de la surveillance la première
 * cause de charge — et sur des liaisons lentes, la première cause de panne.
 */

/** La ligne que Prisma tient de ses propres migrations. */
interface LigneMigration {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

export interface SanteBase {
  joignable: boolean;
  /** Le temps de l'aller-retour, en millisecondes. */
  latenceMs: number | null;
  erreur?: string;
}

export interface SanteMigration {
  /** La dernière appliquée, ou `null` si la base n'a jamais été migrée. */
  derniere: string | null;
  /** Une migration commencée et jamais terminée : le serveur tourne sur une base à moitié faite. */
  interrompue: string | null;
}

export interface SanteRouteurs {
  raccordes: number;
  joignables: number;
  /** Le plus ancien signe de vie parmi les routeurs raccordés. */
  plusVieuxContact: Date | null;
}

export interface Sante {
  statut: 'ok' | 'degrade';
  version: string;
  demarreDepuisSecondes: number;
}

export interface SanteDetaillee extends Sante {
  base: SanteBase;
  migration: SanteMigration;
  routeurs: SanteRouteurs;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly demarreA = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ce que voit un moniteur : la base répond, ou non.
   *
   * Pas de détail, et c'est délibéré. Ce point est ouvert — il doit l'être,
   * un moniteur n'a pas de session — et le nom des migrations, le nombre de
   * routeurs ou celui des exploitants renseigneraient sur l'installation
   * quiconque passe. Le détail se lit connecté.
   */
  async resume(): Promise<Sante> {
    const base = await this.base();
    return {
      statut: base.joignable ? 'ok' : 'degrade',
      version: process.env.npm_package_version ?? '1.0.0',
      demarreDepuisSecondes: Math.floor((Date.now() - this.demarreA) / 1000),
    };
  }

  /** Le même, augmenté de ce qui ne se montre pas à un inconnu. */
  async detail(): Promise<SanteDetaillee> {
    const base = await this.base();
    const [migration, routeurs] = base.joignable
      ? await Promise.all([this.migration(), this.routeurs()])
      : [
          { derniere: null, interrompue: null } satisfies SanteMigration,
          { raccordes: 0, joignables: 0, plusVieuxContact: null } satisfies SanteRouteurs,
        ];

    return {
      statut: base.joignable && !migration.interrompue ? 'ok' : 'degrade',
      version: process.env.npm_package_version ?? '1.0.0',
      demarreDepuisSecondes: Math.floor((Date.now() - this.demarreA) / 1000),
      base,
      migration,
      routeurs,
    };
  }

  private async base(): Promise<SanteBase> {
    const debut = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { joignable: true, latenceMs: Date.now() - debut };
    } catch (e) {
      const erreur = e instanceof Error ? e.message : String(e);
      this.logger.error(`Base injoignable : ${erreur}`);
      return { joignable: false, latenceMs: null, erreur };
    }
  }

  /**
   * L'état des migrations.
   *
   * `interrompue` est la vraie raison de regarder ici. Une migration qui
   * commence et n'aboutit pas laisse une base à moitié faite sur laquelle
   * l'application démarre sans broncher : les écrans marchent jusqu'au
   * premier qui touche la colonne manquante, des heures plus tard, et
   * l'incident ne ressemble plus du tout à un déploiement raté.
   */
  private async migration(): Promise<SanteMigration> {
    try {
      const lignes = await this.prisma.$queryRaw<LigneMigration[]>`
        SELECT migration_name, finished_at, rolled_back_at
        FROM _prisma_migrations
        ORDER BY started_at DESC
        LIMIT 20
      `;
      const interrompue = lignes.find((l) => !l.finished_at && !l.rolled_back_at);
      const derniere = lignes.find((l) => l.finished_at);
      return {
        derniere: derniere?.migration_name ?? null,
        interrompue: interrompue?.migration_name ?? null,
      };
    } catch {
      // Une base jamais migrée n'a pas cette table. Ce n'est pas une panne du
      // serveur, c'est une installation neuve.
      return { derniere: null, interrompue: null };
    }
  }

  /**
   * Les routeurs raccordés, et combien donnent signe de vie.
   *
   * Lu en base, jamais composé. Le client cloisonné est volontairement évité :
   * ce décompte porte sur toute l'installation, et il n'est rendu qu'au
   * SUPER_ADMIN, qui n'appartient à aucun exploitant.
   */
  private async routeurs(): Promise<SanteRouteurs> {
    const raccordes = await this.prisma.router.findMany({
      where: { enrolledAt: { not: null } },
      select: { status: true, lastSeenAt: true },
    });
    const contacts = raccordes
      .map((r) => r.lastSeenAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    return {
      raccordes: raccordes.length,
      joignables: raccordes.filter((r) => r.status === 'online' || r.status === 'enrolled').length,
      plusVieuxContact: contacts[0] ?? null,
    };
  }
}
