import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionStatus, VoucherStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import { RouterAccessService } from '../routers/router-access.service.js';
import {
  ROUTER_OPERATIONS,
  RouterOperationQueue,
} from '../routers/router-operation.service.js';
import { RouterUnreachableException } from '../routers/router-health.service.js';

export interface ExpiryReport {
  /** Tickets dont l'échéance venait de passer. */
  vouchersExpired: number;
  /** Accès réellement coupés : compte désactivé, cookies purgés, session fermée. */
  accessCut: number;
  /** Coupures mises en file, le routeur étant injoignable. */
  deferred: number;
  /** Abonnés suspendus pour tolérance épuisée. */
  subscriptionsSuspended: number;
}

/**
 * Le travail qui **agit**, par opposition à celui qui recopie.
 *
 * La réconciliation lit la collection complète des attributions du routeur et
 * aligne la base dessus : c'est lent, et ce n'est que du recopiage. Ce
 * travail-ci ne lit que ce dont l'échéance vient de passer, d'après des dates
 * déjà en base, et il en tire des gestes.
 *
 * Deux gestes, et un seul compte vraiment :
 *
 * **Couper l'accès d'un ticket expiré.** User Manager fait respecter
 * l'expiration tout seul, application arrêtée — mais seulement pour qui
 * repasse par RADIUS. Un cookie encore valide rouvre la session sans le
 * consulter, et ce parc en garde trois jours. Sans ce travail, un ticket
 * expiré sert donc jusqu'à trois jours de plus, et c'est la perte de revenu
 * la plus directe du modèle.
 *
 * **Suspendre un abonné hors tolérance.** Rien ne le fait aujourd'hui : un
 * impayé reste connecté tant qu'un humain ne s'en aperçoit pas.
 */
@Injectable()
export class ExpiryJobService {
  private readonly logger = new Logger(ExpiryJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: MikrotikClientFactory,
    private readonly access: RouterAccessService,
    private readonly operations: RouterOperationQueue,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Parcourt les exploitants un par un, chacun dans son contexte.
   *
   * Hors requête HTTP, le client cloisonné dégraderait en client non
   * cloisonné : un `updateMany` toucherait alors les lignes de tout le monde.
   * D'où `runAsTenant` autour de chaque exploitant, et `scopedStrict`
   * en dessous, qui refuse de travailler sans exploitant plutôt que de
   * déborder en silence.
   */
  async run(): Promise<ExpiryReport> {
    const total: ExpiryReport = {
      vouchersExpired: 0,
      accessCut: 0,
      deferred: 0,
      subscriptionsSuspended: 0,
    };

    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    for (const { id: tenantId } of tenants) {
      try {
        const report = await this.tenantContext.runAsTenant(tenantId, () => this.runForTenant());
        total.vouchersExpired += report.vouchersExpired;
        total.accessCut += report.accessCut;
        total.deferred += report.deferred;
        total.subscriptionsSuspended += report.subscriptionsSuspended;
      } catch (error) {
        // L'échec d'un exploitant ne doit pas priver les autres du passage :
        // un seul routeur injoignable bloquerait tout le parc.
        this.logger.error(`Expiration en échec pour l'exploitant ${tenantId} : ${String(error)}`);
      }
    }

    if (total.vouchersExpired || total.subscriptionsSuspended || total.deferred) {
      this.logger.log(
        `Expiration : ${total.vouchersExpired} ticket(s) expiré(s), ${total.accessCut} accès coupé(s), ` +
          `${total.deferred} différé(s), ${total.subscriptionsSuspended} abonné(s) suspendu(s)`,
      );
    }
    return total;
  }

  /**
   * Ce que le travail ferait, sans rien faire.
   *
   * Décider d'allumer l'ordonnanceur suppose de savoir ce qu'il coupera à la
   * première minute. Sans cela on l'allume en fermant les yeux sur un parc
   * qui sert des clients — ou, plus probablement, on ne l'allume jamais.
   *
   * Les deux critères sont **repris mot pour mot** de `runForTenant` et de
   * `suspendExhausted`. Les réécrire autrement ferait mentir l'aperçu le jour
   * où l'un des deux changerait, et c'est précisément ce genre d'écart qui
   * rend un aperçu pire que pas d'aperçu du tout.
   */
  async apercu(): Promise<{
    ticketsAExpirer: { code: string; expiresAt: Date | null }[];
    abonnesASuspendre: { username: string; graceEndsAt: Date }[];
  }> {
    const now = new Date();

    const échus = await this.prisma.scopedStrict.voucher.findMany({
      where: {
        expiresAt: { not: null, lte: now },
        status: { in: [VoucherStatus.SOLD, VoucherStatus.ACTIVE] },
        umUsername: { not: null },
      },
      select: { code: true, expiresAt: true },
      take: 500,
    });

    const dépassés = await this.prisma.scopedStrict.subscription.findMany({
      where: {
        graceEndsAt: { lte: now },
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE] },
      },
      select: { hotspotUsername: true, graceEndsAt: true },
      take: 200,
    });

    return {
      ticketsAExpirer: échus,
      abonnesASuspendre: dépassés.map((a) => ({
        username: a.hotspotUsername,
        graceEndsAt: a.graceEndsAt,
      })),
    };
  }

  private async runForTenant(): Promise<ExpiryReport> {
    const report: ExpiryReport = {
      vouchersExpired: 0,
      accessCut: 0,
      deferred: 0,
      subscriptionsSuspended: 0,
    };
    const now = new Date();

    // Seulement ce dont l'échéance est passée et qui n'a pas encore été
    // traité : la collection complète du routeur est l'affaire de la
    // réconciliation, pas de ce travail-ci.
    const échus = await this.prisma.scopedStrict.voucher.findMany({
      where: {
        expiresAt: { not: null, lte: now },
        status: { in: [VoucherStatus.SOLD, VoucherStatus.ACTIVE] },
        umUsername: { not: null },
      },
      select: { id: true, code: true, umUsername: true },
      take: 500,
    });

    for (const ticket of échus) {
      await this.prisma.scopedStrict.voucher.update({
        where: { id: ticket.id },
        data: { status: VoucherStatus.EXPIRED },
      });
      report.vouchersExpired += 1;

      // Le compte reste en place : c'est la trace de ce qui a été vendu. Seul
      // l'accès tombe — cookies et session compris, sans quoi couper ne coupe
      // rien avant trois jours.
      try {
        const routerId = await this.clients.getDefaultRouterId();
        const mikrotik = await this.clients.forRouter(routerId);
        const coupé = await this.access.revoke(mikrotik, ticket.umUsername!, {
          disableAccount: false,
        });
        if (coupé.cookiesRemoved || coupé.sessionsClosed) report.accessCut += 1;
      } catch (error) {
        if (!(error instanceof RouterUnreachableException)) throw error;
        // Le lien est tombé : le ticket est marqué expiré, mais son accès
        // resterait ouvert si personne ne repassait. La file s'en charge.
        await this.operations.enqueue(
          await this.clients.getDefaultRouterId(),
          ROUTER_OPERATIONS.COUPER_ACCES,
          { username: ticket.umUsername! },
          `Ticket ${ticket.code} expiré alors que le routeur était injoignable`,
        );
        report.deferred += 1;
      }
    }

    report.subscriptionsSuspended = await this.suspendExhausted(now);
    return report;
  }

  /**
   * Suspend les abonnés dont la tolérance est épuisée.
   *
   * La suspension n'était jusqu'ici que recommandée : la console la proposait,
   * et personne ne la faisait tant qu'un humain ne cliquait pas. Le critère de
   * sortie du plan est pourtant explicite — l'exploitant part trois jours, et à
   * son retour aucun accès expiré ne fonctionne encore.
   */
  private async suspendExhausted(now: Date): Promise<number> {
    const dépassés = await this.prisma.scopedStrict.subscription.findMany({
      where: {
        graceEndsAt: { lte: now },
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE] },
      },
      select: { id: true, hotspotUsername: true, routerId: true },
      take: 200,
    });

    let suspendus = 0;
    for (const abonnement of dépassés) {
      try {
        const mikrotik = await this.clients.forRouter(abonnement.routerId);
        await this.access.revoke(mikrotik, abonnement.hotspotUsername, { disableAccount: true });

        await this.prisma.scopedStrict.subscription.update({
          where: { id: abonnement.id },
          data: { status: SubscriptionStatus.SUSPENDED, suspendedAt: now },
        });
        suspendus += 1;
      } catch (error) {
        if (!(error instanceof RouterUnreachableException)) throw error;
        // Ne pas marquer suspendu ce qui ne l'est pas : la base dirait
        // suspendu pendant que le routeur laisse passer. L'opération est mise
        // en file, et le statut suivra au prochain passage.
        await this.operations.enqueue(
          abonnement.routerId,
          ROUTER_OPERATIONS.BASCULER_COMPTE,
          { username: abonnement.hotspotUsername, disabled: true },
          `Tolérance épuisée pour ${abonnement.hotspotUsername}, routeur injoignable`,
        );
      }
    }
    return suspendus;
  }
}
