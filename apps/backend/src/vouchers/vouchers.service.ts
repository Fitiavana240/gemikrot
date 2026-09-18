import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Voucher, VoucherStatus } from '@prisma/client';
import { MikrotikNotFoundError } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import type { CreateVoucherBatchDto } from './dto/create-voucher-batch.dto.js';
import { generateVoucherCode } from './voucher-code.util.js';

const MAX_CODE_COLLISION_RETRIES = 5;

@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clients: MikrotikClientFactory,
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

    const mikrotik = await this.clients.forDefaultRouter();
    await mikrotik.createHotspotUser({
      username: voucher.code,
      password: voucher.code,
      profileName: plan.mikrotikProfileName,
      comment: `wifitati:voucher:${voucher.code}`,
    });

    // Le compte HotSpot n'a pas de date d'expiration : c'est le
    // `session-timeout` du profil qui limite la session une fois le client
    // connecté. La durée n'est donc décomptée qu'à partir de la connexion.
    const expiresAt = null;

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
        const mikrotik = await this.clients.forDefaultRouter();
        // Désactivé plutôt que supprimé : le compte reste visible sur le
        // routeur pour tracer ce qui a été vendu.
        await mikrotik.setHotspotUserDisabled(voucher.code, true);
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
