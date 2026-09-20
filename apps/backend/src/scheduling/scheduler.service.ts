import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { VoucherReconciliationService } from '../vouchers/voucher-reconciliation.service.js';
import { JobLockService } from './job-lock.service.js';
import { ExpiryJobService } from './expiry-job.service.js';
import { PurgeJobService } from './purge-job.service.js';

/** Ce qui vient de passer échéance. Agit, et ne lit pas la grande collection. */
const TICK_FIN_MS = 60_000;
/**
 * Relit la collection complète des attributions, par routeur. Cadence choisie
 * d'après le temps réel de lecture : sur le parc mesuré, une lecture complète
 * prend moins d'une seconde pour 646 comptes, mais le routeur sert aussi ses
 * clients pendant ce temps.
 */
const RECONCILIATION_MS = 15 * 60_000;
/** Purge nocturne. Vérifiée toutes les heures, exécutée une fois par nuit. */
const PURGE_CHECK_MS = 60 * 60_000;
const PURGE_HOUR = 3;

/**
 * Cadence les travaux de fond.
 *
 * Écrit à la main plutôt qu'emprunté à `@nestjs/schedule`, pour une raison
 * mesurée : ce paquet se fait remonter à la racine de l'espace de travail et
 * entraîne `@nestjs/common` et `core` avec lui, laissant `platform-express`
 * seul en dessous — l'application ne démarre plus. Trois intervalles fixes ne
 * valent pas ce risque. Même arbitrage que pour la limitation de débit, et
 * pour une raison différente : là c'était l'inadéquation, ici la fragilité.
 *
 * Trois cadences distinctes, et non « tout, toutes les minutes ». La minute
 * sert à ce qui doit agir vite ; relire la collection complète d'un routeur à
 * cette fréquence le chargerait pour rien.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private dernièrePurge: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: JobLockService,
    private readonly expiry: ExpiryJobService,
    private readonly purge: PurgeJobService,
    private readonly reconciliation: VoucherReconciliationService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Coupable en développement et en test : trois minuteries qui appellent un
    // routeur rendraient toute exécution de test dépendante du réseau.
    if (this.config.get<string>('SCHEDULER_ENABLED') !== 'true') {
      this.logger.log('Ordonnanceur désactivé (SCHEDULER_ENABLED)');
      return;
    }

    this.every(TICK_FIN_MS, 'tick-fin', () =>
      this.locks.withLock('tick-fin', 5 * 60_000, () => this.expiry.run()),
    );
    this.every(RECONCILIATION_MS, 'réconciliation', () => this.reconcileAll());
    this.every(PURGE_CHECK_MS, 'purge', () => this.purgeIfNight());

    this.logger.log(
      `Ordonnanceur démarré : expiration ${TICK_FIN_MS / 1000} s, ` +
        `réconciliation ${RECONCILIATION_MS / 60_000} min, purge à ${PURGE_HOUR} h`,
    );
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
  }

  /**
   * Un travail qui échoue ne doit jamais arrêter sa cadence : sans ce
   * garde-fou, une erreur passagère suspend le travail jusqu'au prochain
   * redémarrage de l'application, et personne ne s'en aperçoit.
   */
  private every(ms: number, nom: string, travail: () => Promise<unknown>): void {
    const timer = setInterval(() => {
      void travail().catch((error) => this.logger.error(`Travail « ${nom} » : ${String(error)}`));
    }, ms);
    // Une minuterie qui garde le processus en vie empêcherait un arrêt propre.
    timer.unref();
    this.timers.push(timer);
  }

  /**
   * Réconcilie chaque routeur séparément, chacun sous son propre verrou : un
   * routeur lent ne doit pas retarder les autres, ni se faire doubler par le
   * tour suivant.
   */
  private async reconcileAll(): Promise<void> {
    const routers = await this.prisma.router.findMany({
      select: { id: true, tenantId: true, label: true },
    });

    for (const router of routers) {
      await this.locks.withLock(`reconciliation:${router.id}`, 10 * 60_000, async () => {
        try {
          await this.tenantContext.runAsTenant(router.tenantId, () =>
            this.reconciliation.reconcileTenant(router.id),
          );
        } catch (error) {
          // Un routeur injoignable est un incident courant, pas une panne de
          // l'ordonnanceur : les suivants doivent passer.
          this.logger.warn(`Réconciliation de « ${router.label} » : ${String(error)}`);
        }
      });
    }
  }

  /** Une seule purge par nuit, quelle que soit la fréquence des contrôles. */
  private async purgeIfNight(): Promise<void> {
    const maintenant = new Date();
    const jour = maintenant.toISOString().slice(0, 10);
    if (maintenant.getHours() !== PURGE_HOUR || this.dernièrePurge === jour) return;

    await this.locks.withLock('purge', 30 * 60_000, async () => {
      this.dernièrePurge = jour;
      await this.purge.run();
    });
  }
}
