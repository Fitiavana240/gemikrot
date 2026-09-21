import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Au-delà, un cache ne renseigne plus sur l'état du routeur : il le raconte. */
const CACHE_RETENTION_DAYS = 7;
/**
 * Une demande de paiement abandonnée. Assez long pour qu'un client revienne le
 * lendemain avec sa référence, assez court pour ne pas garder des numéros de
 * téléphone indéfiniment.
 */
const CLAIM_RETENTION_DAYS = 30;
/**
 * Journal d'audit. Deux ans : c'est une trace comptable autant que technique,
 * et la raccourcir reviendrait à effacer la preuve de ce qui a été vendu.
 */
const AUDIT_RETENTION_DAYS = 730;
/**
 * Tickets expirés. Trente jours, décidés par l'exploitant.
 *
 * Comptés depuis le **constat** d'expiration (`expiredAt`) et non depuis
 * l'échéance : si l'ordonnanceur s'arrête une semaine, tout ce qui a expiré
 * pendant ce temps est marqué d'un coup au redémarrage, et il serait absurde
 * d'en effacer aussitôt une partie sous prétexte que son échéance était plus
 * ancienne. Trente jours de délai veut dire trente jours pour aller regarder.
 *
 * Le ticket part même s'il a été payé ; le paiement, lui, reste. C'est ce que
 * permet le `onDelete: SetNull` du lien : la ligne comptable survit à ce
 * qu'elle a soldé, et le journal d'audit garde la trace deux ans.
 */
const VOUCHER_RETENTION_DAYS = 30;

export interface PurgeReport {
  caches: number;
  claims: number;
  auditLogs: number;
  operations: number;
  /** Tickets expirés effacés au terme de leur rétention. */
  vouchers: number;
}

/**
 * Purge nocturne.
 *
 * Rien ici n'est urgent — c'est même l'intérêt de la passer la nuit. Ce qui
 * compte est que les rétentions soient **choisies et écrites**, plutôt que
 * subies : une table qui grossit sans limite finit par coûter une
 * restauration de sauvegarde impossible à tenir dans une fenêtre raisonnable.
 *
 * Volontairement non cloisonné : la purge est un travail de plateforme, elle
 * passe sur tous les exploitants et ne lit aucune donnée métier — seulement
 * des dates.
 */
@Injectable()
export class PurgeJobService {
  private readonly logger = new Logger(PurgeJobService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<PurgeReport> {
    const avant = (jours: number) => new Date(Date.now() - jours * 86_400_000);

    const [users, sessions, stats] = await Promise.all([
      this.prisma.userCacheEntry.deleteMany({
        where: { syncedAt: { lt: avant(CACHE_RETENTION_DAYS) } },
      }),
      this.prisma.sessionCacheEntry.deleteMany({
        where: { syncedAt: { lt: avant(CACHE_RETENTION_DAYS) } },
      }),
      this.prisma.statsCacheEntry.deleteMany({
        where: { syncedAt: { lt: avant(CACHE_RETENTION_DAYS) } },
      }),
    ]);

    const claims = await this.prisma.paymentClaim.deleteMany({
      where: { createdAt: { lt: avant(CLAIM_RETENTION_DAYS) } },
    });

    const auditLogs = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: avant(AUDIT_RETENTION_DAYS) } },
    });

    // Les opérations achevées ou abandonnées ont fini de servir ; celles qui
    // attendent encore restent, quel que soit leur âge.
    const operations = await this.prisma.routerOperation.deleteMany({
      where: {
        status: { in: ['TERMINEE', 'ABANDONNEE'] },
        completedAt: { lt: avant(CLAIM_RETENTION_DAYS) },
      },
    });

    // Les tickets expirés depuis assez longtemps. `expiredAt` nul exclut
    // d'office tout ce qui n'a jamais été constaté expiré, et le statut est
    // vérifié en plus : un ticket repassé en vente ne doit pas disparaître
    // parce qu'il porte encore la date d'un ancien constat.
    const vouchers = await this.prisma.voucher.deleteMany({
      where: {
        status: 'EXPIRED',
        expiredAt: { not: null, lt: avant(VOUCHER_RETENTION_DAYS) },
      },
    });

    const report: PurgeReport = {
      caches: users.count + sessions.count + stats.count,
      claims: claims.count,
      auditLogs: auditLogs.count,
      operations: operations.count,
      vouchers: vouchers.count,
    };

    if (
      report.caches ||
      report.claims ||
      report.auditLogs ||
      report.operations ||
      report.vouchers
    ) {
      this.logger.log(
        `Purge : ${report.caches} entrée(s) de cache, ${report.claims} demande(s), ` +
          `${report.auditLogs} ligne(s) d'audit, ${report.operations} opération(s), ` +
          `${report.vouchers} ticket(s) expiré(s)`,
      );
    }
    return report;
  }
}
