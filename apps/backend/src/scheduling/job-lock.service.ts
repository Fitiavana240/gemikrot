import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Verrou de travail planifié, porté par PostgreSQL.
 *
 * Deux choses à empêcher, et elles n'ont rien à voir l'une avec l'autre. Un
 * routeur lent ne doit pas empiler les réconciliations : la suivante partirait
 * pendant que la précédente attend encore ses quinze secondes de délai. Et
 * deux processus de l'application ne doivent pas balayer le même parc en même
 * temps, ce qui doublerait les appels au routeur sans rien apporter.
 *
 * Le verrou **expire de lui-même**. Un processus tué au milieu d'un travail
 * ne bloque donc pas le parc jusqu'au prochain redémarrage — au pire, le
 * travail reprend une fois le délai passé.
 */
@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);
  /** Identifie ce processus dans la table, pour qu'un blocage se raconte. */
  private readonly holder = `${process.pid}-${randomBytes(3).toString('hex')}`;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Exécute `travail` si le verrou est libre, et rend `null` sinon — sans
   * attendre. Un travail périodique qui trouve porte close n'a pas à faire la
   * queue : la prochaine cadence le reprendra.
   *
   * `ttlMs` borne la durée pendant laquelle le verrou tient sans nouvelle. Le
   * choisir plus long que la durée attendue du travail, sans quoi une
   * exécution lente se ferait doubler par la suivante.
   */
  async withLock<T>(name: string, ttlMs: number, travail: () => Promise<T>): Promise<T | null> {
    if (!(await this.acquire(name, ttlMs))) {
      this.logger.debug(`Verrou « ${name} » déjà tenu, tour passé`);
      return null;
    }

    try {
      return await travail();
    } finally {
      // Libéré même si le travail a échoué : le garder ne protégerait rien et
      // retarderait la reprise d'autant.
      await this.release(name);
    }
  }

  /**
   * Prise atomique. Le `WHERE` de la mise à jour est ce qui rend l'opération
   * sûre : deux processus qui arrivent ensemble exécutent la même instruction,
   * et PostgreSQL n'en laisse qu'un modifier la ligne.
   */
  private async acquire(name: string, ttlMs: number): Promise<boolean> {
    const until = new Date(Date.now() + ttlMs);

    const rows = await this.prisma.$queryRaw<{ name: string }[]>`
      INSERT INTO job_locks (name, locked_until, holder, acquired_at)
      VALUES (${name}, ${until}, ${this.holder}, now())
      ON CONFLICT (name) DO UPDATE
        SET locked_until = EXCLUDED.locked_until,
            holder = EXCLUDED.holder,
            acquired_at = now()
        WHERE job_locks.locked_until < now()
      RETURNING name
    `;
    return rows.length > 0;
  }

  /** Ne libère que son propre verrou : celui d'un autre ne nous appartient pas. */
  private async release(name: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE job_locks SET locked_until = now()
        WHERE name = ${name} AND holder = ${this.holder}
      `;
    } catch (error) {
      // Un verrou non libéré expirera seul : le signaler suffit, échouer ici
      // masquerait le résultat du travail qui vient de s'achever.
      this.logger.warn(`Verrou « ${name} » non libéré : ${String(error)}`);
    }
  }
}
