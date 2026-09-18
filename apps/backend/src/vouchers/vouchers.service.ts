import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Voucher, VoucherStatus } from '@prisma/client';
import { MikrotikNotFoundError } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import { parseRouterTime } from '../routers/router-time.util.js';
import { PlanProvisioningService } from '../plans/plan-provisioning.service.js';
import { VoucherAccessService } from './voucher-access.service.js';
import type { CreateVoucherBatchDto } from './dto/create-voucher-batch.dto.js';
import { generateVoucherCode } from './voucher-code.util.js';

const MAX_CODE_COLLISION_RETRIES = 5;

@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clients: MikrotikClientFactory,
    private readonly provisioning: PlanProvisioningService,
    private readonly access: VoucherAccessService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * `scope` distingue les deux générations : `um` pour les tickets servis par
   * User Manager, `legacy` pour ceux d'avant la bascule, encore sur le
   * HotSpot local et sans échéance.
   */
  findAll(
    filter: { status?: VoucherStatus; planId?: string; scope?: 'um' | 'legacy' } = {},
  ): Promise<Voucher[]> {
    const { scope, ...rest } = filter;
    return this.prisma.scoped.voucher.findMany({
      where: {
        ...rest,
        ...(scope === 'um' ? { umUsername: { not: null } } : {}),
        ...(scope === 'legacy' ? { umUsername: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Tickets expirés. Le statut seul ne suffit pas : entre deux
   * réconciliations, un ticket dont l'échéance est passée porte encore
   * VENDU. Le routeur, lui, a déjà cessé de le servir — la liste doit dire
   * la même chose que le réseau.
   */
  findExpired(): Promise<Voucher[]> {
    return this.prisma.scoped.voucher.findMany({
      where: {
        OR: [
          { status: VoucherStatus.EXPIRED },
          {
            status: { in: [VoucherStatus.SOLD, VoucherStatus.ACTIVE] },
            expiresAt: { lt: new Date() },
          },
        ],
      },
      orderBy: { expiresAt: 'desc' },
    });
  }

  /**
   * Répartition par offre — un profil User Manager, une offre. Donne d'un
   * coup d'œil ce qui reste à vendre et ce qui est consommé.
   */
  async countByPlan(): Promise<
    {
      planId: string;
      planName: string;
      price: string;
      umProfileName: string | null;
      validityDurationSeconds: number;
      counts: Record<string, number>;
      total: number;
    }[]
  > {
    const [plans, grouped] = await Promise.all([
      this.prisma.scoped.plan.findMany({
        select: {
          id: true,
          name: true,
          price: true,
          umProfileName: true,
          validityDurationSeconds: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.scoped.voucher.groupBy({ by: ['planId', 'status'], _count: { _all: true } }),
    ]);

    return plans.map((plan) => {
      const rows = grouped.filter((row) => row.planId === plan.id);
      const counts: Record<string, number> = {};
      let total = 0;
      for (const row of rows) {
        counts[row.status] = row._count._all;
        total += row._count._all;
      }
      return {
        planId: plan.id,
        planName: plan.name,
        price: plan.price.toString(),
        umProfileName: plan.umProfileName,
        validityDurationSeconds: plan.validityDurationSeconds,
        counts,
        total,
      };
    });
  }

  async findOne(id: string): Promise<Voucher> {
    const voucher = await this.prisma.scoped.voucher.findUnique({ where: { id } });
    if (!voucher) throw new NotFoundException(`Voucher ${id} introuvable`);
    return voucher;
  }

  async findByCode(code: string): Promise<Voucher> {
    const voucher = await this.prisma.scoped.voucher.findUnique({ where: { code } });
    if (!voucher) throw new NotFoundException(`Voucher ${code} introuvable`);
    return voucher;
  }

  /** Un voucher CREATED déjà généré et pas encore attribué à un client. */
  findAvailableForPlan(planId: string): Promise<Voucher | null> {
    return this.prisma.scoped.voucher.findFirst({
      where: { planId, status: VoucherStatus.CREATED, customerId: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Génère un voucher à la volée, hors lot, pour attribution immédiate. */
  async generateSingle(planId: string): Promise<Voucher> {
    const plan = await this.getActivePlan(planId);
    return this.createVoucherWithUniqueCode({ planId: plan.id, price: plan.price });
  }

  /** Génération synchrone d'un lot (Section 18). Adapté jusqu'à ~1000 vouchers. */
  async generateBatch(dto: CreateVoucherBatchDto, adminUserId: string): Promise<Voucher[]> {
    const plan = await this.getActivePlan(dto.planId);
    const routerId = dto.routerId ?? (await this.getDefaultRouterId());

    const batch = await this.prisma.scoped.voucherBatch.create({
      data: {
        tenantId: this.tenantContext.requireTenantId(),
        routerId,
        planId: plan.id,
        quantity: dto.quantity,
        prefix: dto.prefix,
        createdByAdminId: adminUserId,
        status: 'PENDING',
        jobs: { create: { total: dto.quantity, status: 'running', startedAt: new Date() } },
      },
      include: { jobs: true },
    });

    try {
      const vouchers: Voucher[] = [];
      for (let i = 0; i < dto.quantity; i += 1) {
        vouchers.push(
          await this.createVoucherWithUniqueCode({
            planId: plan.id,
            price: plan.price,
            batchId: batch.id,
            prefix: dto.prefix,
          }),
        );
      }

      // Les comptes sont créés sur le routeur dès la génération : un ticket
      // imprimé fonctionne immédiatement, sans qu'un vendeur ait à l'activer
      // dans la console. La validité ne court qu'à la première connexion, un
      // ticket invendu ne s'use donc pas.
      const provisioned = await this.provisionOnUserManager(vouchers, plan, routerId);

      await this.prisma.scoped.voucherBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED' } });
      await this.prisma.scoped.voucherJob.update({
        where: { id: batch.jobs[0].id },
        data: { processed: vouchers.length, status: 'completed', finishedAt: new Date() },
      });
      await this.audit.log({
        adminUserId,
        action: 'CREATE_VOUCHER_BATCH',
        targetType: 'VoucherBatch',
        targetId: batch.id,
        payloadDiff: { planId: plan.id, quantity: dto.quantity, routerId },
      });

      return provisioned;
    } catch (error) {
      await this.prisma.scoped.voucherBatch.update({ where: { id: batch.id }, data: { status: 'FAILED' } });
      await this.prisma.scoped.voucherJob.update({
        where: { id: batch.jobs[0].id },
        data: { status: 'failed', errorMessage: String(error), finishedAt: new Date() },
      });
      throw error;
    }
  }

  /**
   * Provisionne le voucher comme compte HotSpot et l'attribue au client.
   * Appelé par `PaymentsService` une fois le paiement vérifié (Section 24).
   *
   * `code` sert à la fois de nom d'utilisateur et de mot de passe RouterOS
   * (Section 6 : un seul champ à saisir côté client).
   */
  async activate(
    voucherId: string,
    params: { customerId: string; deviceId?: string; adminUserId?: string },
  ): Promise<Voucher> {
    const voucher = await this.findOne(voucherId);
    if (voucher.status !== VoucherStatus.CREATED) {
      throw new ConflictException(`Voucher ${voucher.code} n'est plus disponible (${voucher.status})`);
    }
    const plan = await this.getActivePlan(voucher.planId);

    // Le compte existe déjà sur le routeur depuis la génération du lot : le
    // ticket imprimé fonctionnait avant même d'être vendu. Ne reste ici que
    // le rattachement commercial. Un ticket d'avant la bascule n'a pas de
    // compte User Manager : il est provisionné maintenant, sur le HotSpot,
    // pour ne pas changer le comportement de l'existant.
    let expiresAt: Date | null = null;
    let umState: string | null = voucher.umState;

    if (voucher.umUsername) {
      const mikrotik = await this.clients.forDefaultRouter();
      const [assignments, clock] = await Promise.all([
        mikrotik.getUserManagerUserProfiles(voucher.umUsername),
        mikrotik.getClock(),
      ]);
      const current = assignments.find((a) => a.profileName === plan.umProfileName) ?? assignments[0];
      expiresAt = parseRouterTime(current?.endTime, clock.gmtOffset);
      umState = current?.state ?? umState;
    } else {
      const mikrotik = await this.clients.forDefaultRouter();
      await mikrotik.createHotspotUser({
        username: voucher.code,
        password: voucher.code,
        profileName: plan.mikrotikProfileName,
        comment: `wifitati:voucher:${voucher.code}`,
      });
    }

    const updated = await this.prisma.scoped.voucher.update({
      where: { id: voucher.id },
      data: {
        status: VoucherStatus.SOLD,
        customerId: params.customerId,
        deviceId: params.deviceId,
        activatedAt: new Date(),
        expiresAt,
        umState,
        lastReconciledAt: voucher.umUsername ? new Date() : null,
      },
    });

    await this.audit.log({
      adminUserId: params.adminUserId,
      action: 'ACTIVATE_VOUCHER',
      targetType: 'Voucher',
      targetId: voucher.id,
      payloadDiff: { customerId: params.customerId, planId: plan.id },
    });

    return updated;
  }

  async disable(id: string, adminUserId?: string): Promise<Voucher> {
    const voucher = await this.findOne(id);

    try {
      const mikrotik = await this.clients.forDefaultRouter();
      // Désactivé plutôt que supprimé : le compte reste visible sur le
      // routeur pour tracer ce qui a été vendu.
      if (voucher.umUsername) {
        // Désactiver ne suffit pas : un cookie encore valide rouvre la
        // session sans repasser par RADIUS, donc sans consulter User
        // Manager. Cookies et session en cours partent avec.
        await this.access.revoke(mikrotik, voucher.umUsername);
      } else if (voucher.status === VoucherStatus.SOLD || voucher.status === VoucherStatus.ACTIVE) {
        await mikrotik.setHotspotUserDisabled(voucher.code, true);
        await this.access.purgeCookies(mikrotik, voucher.code);
        await this.access.closeSessions(mikrotik, voucher.code);
      }
    } catch (error) {
      if (!(error instanceof MikrotikNotFoundError)) throw error;
    }

    const updated = await this.prisma.scoped.voucher.update({
      where: { id },
      data: { status: VoucherStatus.DISABLED },
    });
    await this.audit.log({
      adminUserId,
      action: 'DISABLE_USER',
      targetType: 'Voucher',
      targetId: id,
    });
    return updated;
  }

  async cancel(id: string, adminUserId?: string): Promise<Voucher> {
    const voucher = await this.findOne(id);
    if (voucher.status !== VoucherStatus.CREATED) {
      throw new ConflictException(
        `Voucher ${voucher.code} déjà attribué : utiliser disable(), pas cancel()`,
      );
    }
    const updated = await this.prisma.scoped.voucher.update({
      where: { id },
      data: { status: VoucherStatus.CANCELLED },
    });
    await this.audit.log({ adminUserId, action: 'CANCEL_VOUCHER', targetType: 'Voucher', targetId: id });
    return updated;
  }

/**
   * Crée les comptes User Manager du lot et leur attribue le profil de
   * l'offre. Les comptes partent en une seule passe : la liste des comptes
   * existants n'est relue qu'une fois, là où un appel unitaire la relirait à
   * chaque ticket.
   *
   * Le code sert de nom d'utilisateur **et** de mot de passe : le client n'a
   * qu'un seul champ à saisir sur le portail captif.
   */
  private async provisionOnUserManager(
    vouchers: Voucher[],
    plan: { id: string; name: string },
    routerId: string,
  ): Promise<Voucher[]> {
    const { profileName } = await this.provisioning.reconcile(plan.id, routerId);
    const mikrotik = await this.clients.forRouter(routerId);
    const tenantId = this.tenantContext.requireTenantId();

    await mikrotik.createUserManagerUsers(
      vouchers.map((voucher) => ({
        username: voucher.code,
        password: voucher.code,
        comment: `gemikrot:t:${tenantId.slice(0, 8)}:v:${voucher.code}`,
      })),
    );

    const updated: Voucher[] = [];
    for (const voucher of vouchers) {
      const assignment = await mikrotik.assignProfile({
        username: voucher.code,
        profileName,
      });
      updated.push(
        await this.prisma.scoped.voucher.update({
          where: { id: voucher.id },
          data: {
            umUsername: voucher.code,
            umState: assignment.state,
            lastReconciledAt: new Date(),
          },
        }),
      );
    }
    return updated;
  }

  private async getActivePlan(planId: string) {
    const plan = await this.prisma.scoped.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Plan ${planId} introuvable`);
    if (plan.status !== 'ACTIVE') throw new ConflictException(`Plan ${plan.name} n'est plus actif`);
    return plan;
  }

  private async getDefaultRouterId(): Promise<string> {
    const router = await this.prisma.scoped.router.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!router) {
      throw new ConflictException(
        'Aucun routeur enregistré en base — renseigner routerId ou exécuter le seed',
      );
    }
    return router.id;
  }

  private async createVoucherWithUniqueCode(input: {
    planId: string;
    price: Prisma.Decimal | number;
    batchId?: string;
    prefix?: string;
  }): Promise<Voucher> {
    for (let attempt = 0; attempt < MAX_CODE_COLLISION_RETRIES; attempt += 1) {
      const code = generateVoucherCode(10, input.prefix);
      try {
        return await this.prisma.scoped.voucher.create({
          data: {
            tenantId: this.tenantContext.requireTenantId(),
            code,
            planId: input.planId,
            price: input.price,
            batchId: input.batchId,
          },
        });
      } catch (error) {
        const isUniqueCollision =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!isUniqueCollision) throw error;
      }
    }
    throw new ConflictException('Impossible de générer un code voucher unique après plusieurs essais');
  }
}
