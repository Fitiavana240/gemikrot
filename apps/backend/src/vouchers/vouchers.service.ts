import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Voucher, VoucherStatus } from '@prisma/client';
import type { IMikrotikService } from '@wifitati/mikrotik-service';
import { MikrotikNotFoundError } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MIKROTIK_SERVICE } from '../mikrotik/mikrotik.constants.js';
import type { CreateVoucherBatchDto } from './dto/create-voucher-batch.dto.js';
import { generateVoucherCode } from './voucher-code.util.js';

const MAX_CODE_COLLISION_RETRIES = 5;

@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(MIKROTIK_SERVICE) private readonly mikrotik: IMikrotikService,
  ) {}

  findAll(filter: { status?: VoucherStatus; planId?: string } = {}): Promise<Voucher[]> {
    return this.prisma.voucher.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<Voucher> {
    const voucher = await this.prisma.voucher.findUnique({ where: { id } });
    if (!voucher) throw new NotFoundException(`Voucher ${id} introuvable`);
    return voucher;
  }

  async findByCode(code: string): Promise<Voucher> {
    const voucher = await this.prisma.voucher.findUnique({ where: { code } });
    if (!voucher) throw new NotFoundException(`Voucher ${code} introuvable`);
    return voucher;
  }

  /** Un voucher CREATED déjà généré et pas encore attribué à un client. */
  findAvailableForPlan(planId: string): Promise<Voucher | null> {
    return this.prisma.voucher.findFirst({
      where: { planId, status: VoucherStatus.CREATED, customerId: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Génère un voucher à la volée, hors lot, pour attribution immédiate. */
  async generateSingle(planId: string): Promise<Voucher> {
    const plan = await this.getActivePlan(planId);
    return this.createVoucherWithUniqueCode({ planId: plan.id, priceAr: plan.priceAr });
  }

  /** Génération synchrone d'un lot (Section 18). Adapté jusqu'à ~1000 vouchers. */
  async generateBatch(dto: CreateVoucherBatchDto, adminUserId: string): Promise<Voucher[]> {
    const plan = await this.getActivePlan(dto.planId);
    const routerId = dto.routerId ?? (await this.getDefaultRouterId());

    const batch = await this.prisma.voucherBatch.create({
      data: {
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
            priceAr: plan.priceAr,
            batchId: batch.id,
            prefix: dto.prefix,
          }),
        );
      }

      await this.prisma.voucherBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED' } });
      await this.prisma.voucherJob.update({
        where: { id: batch.jobs[0].id },
        data: { processed: vouchers.length, status: 'completed', finishedAt: new Date() },
      });
      await this.audit.log({
        adminUserId,
        action: 'CREATE_VOUCHER_BATCH',
        targetType: 'VoucherBatch',
        targetId: batch.id,
        payloadDiff: { planId: plan.id, quantity: dto.quantity },
      });

      return vouchers;
    } catch (error) {
      await this.prisma.voucherBatch.update({ where: { id: batch.id }, data: { status: 'FAILED' } });
      await this.prisma.voucherJob.update({
        where: { id: batch.jobs[0].id },
        data: { status: 'failed', errorMessage: String(error), finishedAt: new Date() },
      });
      throw error;
    }
  }

  /**
   * Provisionne le voucher côté User Manager (création utilisateur +
   * assignation du profil) et l'attribue au client. Appelé par
   * `PaymentsService` une fois le paiement vérifié (Section 24).
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

    await this.mikrotik.createUserManagerUser({
      username: voucher.code,
      password: voucher.code,
      comment: `wifitati:voucher:${voucher.code}`,
    });
    await this.mikrotik.assignProfile({ username: voucher.code, profileName: plan.mikrotikProfileName });

    // La véritable expiration dépend de `starts-when` côté User Manager
    // (Section 12) : avec CREATION, elle démarre maintenant ; avec LOGON,
    // elle ne démarre qu'à la première authentification et n'est donc pas
    // connue ici (null, à réconcilier plus tard via getUserManagerUserProfiles).
    const expiresAt =
      plan.startsWhen === 'CREATION'
        ? new Date(Date.now() + plan.validityDurationSeconds * 1000)
        : null;

    const updated = await this.prisma.voucher.update({
      where: { id: voucher.id },
      data: {
        status: VoucherStatus.SOLD,
        customerId: params.customerId,
        deviceId: params.deviceId,
        activatedAt: new Date(),
        expiresAt,
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

    if (voucher.status === VoucherStatus.SOLD || voucher.status === VoucherStatus.ACTIVE) {
      try {
        await this.mikrotik.deleteUserManagerUser(voucher.code);
      } catch (error) {
        if (!(error instanceof MikrotikNotFoundError)) throw error;
      }
    }

    const updated = await this.prisma.voucher.update({
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
    const updated = await this.prisma.voucher.update({
      where: { id },
      data: { status: VoucherStatus.CANCELLED },
    });
    await this.audit.log({ adminUserId, action: 'CANCEL_VOUCHER', targetType: 'Voucher', targetId: id });
    return updated;
  }

  private async getActivePlan(planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Plan ${planId} introuvable`);
    if (plan.status !== 'ACTIVE') throw new ConflictException(`Plan ${plan.name} n'est plus actif`);
    return plan;
  }

  private async getDefaultRouterId(): Promise<string> {
    const router = await this.prisma.router.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!router) {
      throw new ConflictException(
        'Aucun routeur enregistré en base — renseigner routerId ou exécuter le seed',
      );
    }
    return router.id;
  }

  private async createVoucherWithUniqueCode(input: {
    planId: string;
    priceAr: Prisma.Decimal | number;
    batchId?: string;
    prefix?: string;
  }): Promise<Voucher> {
    for (let attempt = 0; attempt < MAX_CODE_COLLISION_RETRIES; attempt += 1) {
      const code = generateVoucherCode(10, input.prefix);
      try {
        return await this.prisma.voucher.create({
          data: {
            code,
            planId: input.planId,
            priceAr: input.priceAr,
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
