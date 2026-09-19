import { Injectable, Logger } from '@nestjs/common';
import { VoucherStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import { ROUTER_OPERATIONS, RouterOperationQueue } from '../routers/router-operation.service.js';
import { RouterUnreachableException } from '../routers/router-health.service.js';
import { parseRouterTime } from '../routers/router-time.util.js';
import { RouterAccessService } from '../routers/router-access.service.js';

export interface ReconcileVouchersReport {
  examined: number;
  expired: number;
  activated: number;
  accessCut: number;
  /** Coupures mises en file faute de routeur joignable. */
  deferred: number;
}

/**
 * Aligne l'état des tickets sur ce que le routeur applique déjà.
 *
 * L'expiration n'est pas décidée ici : User Manager la tient et la fait
 * respecter, même cette application arrêtée. Ce service ne fait que recopier
 * `end-time` et l'état en base, pour que les écrans soient justes.
 *
 * Une chose ne se recopie pas, elle s'exécute : couper l'accès d'un ticket
 * qui vient d'expirer. Un cookie encore valide rouvrirait la session sans
 * repasser par RADIUS, donc sans consulter la validité.
 */
@Injectable()
export class VoucherReconciliationService {
  private readonly logger = new Logger(VoucherReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: MikrotikClientFactory,
    private readonly access: RouterAccessService,
    private readonly operations: RouterOperationQueue,
  ) {}

  /**
   * Réconcilie les tickets de l'exploitant courant. L'appelant doit s'être
   * placé sur un exploitant — `scopedStrict` refuse sinon, plutôt que de
   * parcourir les tickets de tout le monde.
   */
  async reconcileTenant(routerId?: string): Promise<ReconcileVouchersReport> {
    const mikrotik = routerId
      ? await this.clients.forRouter(routerId)
      : await this.clients.forDefaultRouter();

    const candidates = await this.prisma.scopedStrict.voucher.findMany({
      where: {
        umUsername: { not: null },
        status: { in: [VoucherStatus.CREATED, VoucherStatus.SOLD, VoucherStatus.ACTIVE] },
      },
      select: { id: true, code: true, umUsername: true, status: true, expiresAt: true },
    });

    if (candidates.length === 0) {
      return { examined: 0, expired: 0, activated: 0, accessCut: 0, deferred: 0 };
    }

    // Une seule lecture de la collection pour tout le lot : la filtrer par
    // compte ferait un appel par ticket.
    const [assignments, clock] = await Promise.all([
      mikrotik.getUserManagerUserProfiles(),
      mikrotik.getClock(),
    ]);

    const byUser = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const list = byUser.get(assignment.username) ?? [];
      list.push(assignment);
      byUser.set(assignment.username, list);
    }

    const now = Date.now();
    const report: ReconcileVouchersReport = {
      examined: candidates.length,
      expired: 0,
      activated: 0,
      accessCut: 0,
      deferred: 0,
    };

    for (const voucher of candidates) {
      const mine = byUser.get(voucher.umUsername!) ?? [];
      if (mine.length === 0) continue;

      // Un rachat ajoute une attribution : l'échéance qui compte est la plus
      // lointaine, sinon un ticket renouvelé passerait pour expiré.
      const endTime = mine
        .map((a) => parseRouterTime(a.endTime, clock.gmtOffset))
        .filter((date): date is Date => date !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

      const state = mine.find((a) => a.state === 'running-active')?.state ?? mine[0].state;
      const consumed = mine.every((a) => a.state === 'used');
      const isExpired = consumed || (endTime !== null && endTime.getTime() <= now);

      let status = voucher.status;
      if (isExpired) {
        status = VoucherStatus.EXPIRED;
      } else if (endTime !== null && voucher.status === VoucherStatus.SOLD) {
        // L'échéance existe : le client s'est connecté au moins une fois.
        status = VoucherStatus.ACTIVE;
      }

      const changed = status !== voucher.status || endTime?.getTime() !== voucher.expiresAt?.getTime();
      if (!changed) continue;

      await this.prisma.scopedStrict.voucher.update({
        where: { id: voucher.id },
        data: { status, expiresAt: endTime, umState: state, lastReconciledAt: new Date() },
      });

      if (status === VoucherStatus.EXPIRED && voucher.status !== VoucherStatus.EXPIRED) {
        report.expired += 1;
        // Le compte reste en place : c'est la trace de ce qui a été vendu.
        // Seul l'accès est coupé, cookies et session compris.
        try {
          const cut = await this.access.revoke(mikrotik, voucher.umUsername!, {
            disableAccount: false,
          });
          if (cut.cookiesRemoved || cut.sessionsClosed) report.accessCut += 1;
        } catch (error) {
          // Le lien est tombé en pleine réconciliation. Le ticket est marqué
          // expiré, mais son accès reste ouvert : sans mise en file, personne
          // ne repasserait jamais le couper.
          if (!(error instanceof RouterUnreachableException)) throw error;
          await this.operations.enqueue(
            routerId ?? (await this.clients.getDefaultRouterId()),
            ROUTER_OPERATIONS.COUPER_ACCES,
            { username: voucher.umUsername! },
            `Ticket ${voucher.code} expiré alors que le routeur était injoignable`,
          );
          report.deferred += 1;
        }
      } else if (status === VoucherStatus.ACTIVE && voucher.status !== VoucherStatus.ACTIVE) {
        report.activated += 1;
      }
    }

    if (report.expired || report.activated) {
      this.logger.log(
        `Tickets réconciliés : ${report.examined} examinés, ${report.expired} expirés, ${report.activated} activés`,
      );
    }
    return report;
  }
}
