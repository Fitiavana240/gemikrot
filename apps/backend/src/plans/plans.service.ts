import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Plan, ProfileStartsWhen } from '@prisma/client';
import type { IMikrotikService } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { MIKROTIK_SERVICE } from '../mikrotik/mikrotik.constants.js';
import type { CreatePlanDto } from './dto/create-plan.dto.js';
import type { UpdatePlanDto } from './dto/update-plan.dto.js';

const STARTS_WHEN_TO_MIKROTIK: Record<ProfileStartsWhen, 'logon' | 'creation'> = {
  LOGON: 'logon',
  CREATION: 'creation',
};

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
    @Inject(MIKROTIK_SERVICE) private readonly mikrotik: IMikrotikService,
  ) {}

  findAll(): Promise<Plan[]> {
    return this.prisma.plan.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string): Promise<Plan> {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException(`Plan ${id} introuvable`);
    return plan;
  }

  /**
   * Crée l'offre en base puis provisionne le profil User Manager
   * correspondant. Si la création RouterOS échoue, la ligne Postgres est
   * annulée pour ne jamais laisser une offre "orpheline" sans profil réseau
   * (Section 8 : toute écriture RouterOS doit rester cohérente avec l'état
   * applicatif).
   */
  async create(dto: CreatePlanDto): Promise<Plan> {
    const mikrotikProfileName = await this.reserveProfileName(dto.name);

    const plan = await this.prisma.plan.create({
      data: {
        name: dto.name,
        description: dto.description,
        priceAr: dto.priceAr,
        validityDurationSeconds: dto.validityDurationSeconds,
        startsWhen: dto.startsWhen,
        rateLimitRxBps: dto.rateLimitRxBps,
        rateLimitTxBps: dto.rateLimitTxBps,
        transferLimitBytes: dto.transferLimitBytes,
        maxSharedUsers: dto.maxSharedUsers,
        mikrotikProfileName,
      },
    });

    try {
      await this.mikrotik.createProfile({
        name: mikrotikProfileName,
        validityDurationSeconds: dto.validityDurationSeconds,
        startsWhen: STARTS_WHEN_TO_MIKROTIK[dto.startsWhen],
        rateLimitRxBitsPerSecond: dto.rateLimitRxBps,
        rateLimitTxBitsPerSecond: dto.rateLimitTxBps,
        transferLimitBytes: dto.transferLimitBytes,
        sharedUsers: dto.maxSharedUsers,
      });
    } catch (error) {
      await this.prisma.plan.delete({ where: { id: plan.id } });
      throw error;
    }

    return plan;
  }

  async update(id: string, dto: UpdatePlanDto): Promise<Plan> {
    const existing = await this.findOne(id);

    await this.mikrotik.updateProfile({
      name: existing.mikrotikProfileName,
      validityDurationSeconds: dto.validityDurationSeconds,
      startsWhen: dto.startsWhen ? STARTS_WHEN_TO_MIKROTIK[dto.startsWhen] : undefined,
      rateLimitRxBitsPerSecond: dto.rateLimitRxBps,
      rateLimitTxBitsPerSecond: dto.rateLimitTxBps,
      transferLimitBytes: dto.transferLimitBytes,
      sharedUsers: dto.maxSharedUsers,
    });

    return this.prisma.plan.update({
      where: { id },
      data: {
        description: dto.description,
        priceAr: dto.priceAr,
        validityDurationSeconds: dto.validityDurationSeconds,
        startsWhen: dto.startsWhen,
        rateLimitRxBps: dto.rateLimitRxBps,
        rateLimitTxBps: dto.rateLimitTxBps,
        transferLimitBytes: dto.transferLimitBytes,
        maxSharedUsers: dto.maxSharedUsers,
      },
    });
  }

  async archive(id: string): Promise<Plan> {
    await this.findOne(id);
    return this.prisma.plan.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  /** Dérive un nom de profil RouterOS à partir du nom commercial. */
  private async reserveProfileName(planName: string): Promise<string> {
    const candidate = slugifyProfileName(planName);
    const collision = await this.prisma.plan.findUnique({
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
