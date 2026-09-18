import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Plan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import type { CreatePlanDto } from './dto/create-plan.dto.js';
import type { UpdatePlanDto } from './dto/update-plan.dto.js';

function slugifyProfileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
}

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: MikrotikClientFactory,
    private readonly tenantContext: TenantContextService,
  ) {}

  findAll(): Promise<Plan[]> {
    return this.prisma.scoped.plan.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string): Promise<Plan> {
    const plan = await this.prisma.scoped.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException(`Plan ${id} introuvable`);
    return plan;
  }

  /**
   * Crée l'offre en base puis provisionne le profil HotSpot correspondant.
   * Si la création RouterOS échoue, la ligne Postgres est annulée pour ne
   * jamais laisser une offre "orpheline" sans profil réseau (Section 8).
   *
   * Le profil est créé sur le routeur par défaut : la politique de réplication
   * entre sites (tarifs communs ou par site) n'est pas encore arbitrée, et
   * un seul routeur est déployé aujourd'hui.
   */
  async create(dto: CreatePlanDto): Promise<Plan> {
    const mikrotikProfileName = await this.reserveProfileName(dto.name);

    const plan = await this.prisma.scoped.plan.create({
      data: {
        tenantId: this.tenantContext.requireTenantId(),
        name: dto.name,
        description: dto.description,
        price: dto.price,
        validityDurationSeconds: dto.validityDurationSeconds,
        startsWhen: dto.startsWhen,
        rateLimitRxBps: dto.rateLimitRxBps,
        rateLimitTxBps: dto.rateLimitTxBps,
        transferLimitBytes: dto.transferLimitBytes,
        maxSharedUsers: dto.maxSharedUsers,
        kind: dto.subscriptionPeriodDays ? 'SUBSCRIPTION' : 'TICKET',
        subscriptionPeriodDays: dto.subscriptionPeriodDays,
        sessionTimeoutSeconds: dto.validityDurationSeconds,
        mikrotikProfileName,
      },
    });

    try {
      const mikrotik = await this.clients.forDefaultRouter();
      await mikrotik.createHotspotProfile({
        name: mikrotikProfileName,
        rateLimitRxBitsPerSecond: dto.rateLimitRxBps,
        rateLimitTxBitsPerSecond: dto.rateLimitTxBps,
        sessionTimeoutSeconds: dto.validityDurationSeconds,
        sharedUsers: dto.maxSharedUsers,
      });
    } catch (error) {
      await this.prisma.scoped.plan.delete({ where: { id: plan.id } });
      throw error;
    }

    return plan;
  }

  async update(id: string, dto: UpdatePlanDto): Promise<Plan> {
    const existing = await this.findOne(id);

    const mikrotik = await this.clients.forDefaultRouter();
    await mikrotik.updateHotspotProfile({
      name: existing.mikrotikProfileName,
      rateLimitRxBitsPerSecond: dto.rateLimitRxBps,
      rateLimitTxBitsPerSecond: dto.rateLimitTxBps,
      sessionTimeoutSeconds: dto.validityDurationSeconds,
      sharedUsers: dto.maxSharedUsers,
    });

    return this.prisma.scoped.plan.update({
      where: { id },
      data: {
        description: dto.description,
        price: dto.price,
        validityDurationSeconds: dto.validityDurationSeconds,
        startsWhen: dto.startsWhen,
        rateLimitRxBps: dto.rateLimitRxBps,
        rateLimitTxBps: dto.rateLimitTxBps,
        transferLimitBytes: dto.transferLimitBytes,
        maxSharedUsers: dto.maxSharedUsers,
        subscriptionPeriodDays: dto.subscriptionPeriodDays,
        sessionTimeoutSeconds: dto.validityDurationSeconds,
      },
    });
  }

  async archive(id: string): Promise<Plan> {
    await this.findOne(id);
    return this.prisma.scoped.plan.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  /** Dérive un nom de profil RouterOS à partir du nom commercial. */
  private async reserveProfileName(planName: string): Promise<string> {
    const candidate = slugifyProfileName(planName);
    const collision = await this.prisma.scoped.plan.findFirst({
      where: { mikrotikProfileName: candidate },
    });
    if (collision) {
      // Deux noms commerciaux distincts (ex: accents/casse différents)
      // peuvent se réduire au même identifiant RouterOS : signalé plutôt
      // que masqué silencieusement par un suffixe auto-généré.
      throw new ConflictException(
        `Le profil RouterOS dérivé de "${planName}" existe déjà (${candidate})`,
      );
    }
    return candidate;
  }
}
