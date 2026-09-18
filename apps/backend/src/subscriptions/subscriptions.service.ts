import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Payment, Subscription, SubscriptionStatus } from '@prisma/client';
import { MikrotikNotFoundError } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import type { CreateSubscriptionDto } from './dto/create-subscription.dto.js';

/** Tolérance après expiration avant suspension (Section 5 : 7 jours). */
export const GRACE_PERIOD_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

export interface SubscriptionRecommendation {
  subscription: Subscription;
  /** Jours restants avant expiration — négatif si déjà expiré. */
  daysRemaining: number;
  reason: 'EXPIRING_SOON' | 'IN_GRACE' | 'GRACE_ENDED';
  recommendedAction: 'WARN_CUSTOMER' | 'SUSPEND';
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clients: MikrotikClientFactory,
  ) {}

  findAll(filter: { status?: SubscriptionStatus; customerId?: string } = {}): Promise<Subscription[]> {
    return this.prisma.subscription.findMany({
      where: filter,
      orderBy: { currentPeriodEnd: 'asc' },
    });
  }

  async findOne(id: string): Promise<Subscription> {
    const subscription = await this.prisma.subscription.findUnique({ where: { id } });
    if (!subscription) throw new NotFoundException(`Abonnement ${id} introuvable`);
    return subscription;
  }

  /**
   * Crée le compte HotSpot sur le routeur puis l'abonnement en base. En cas
   * d'échec RouterOS, rien n'est persisté (Section 8 : l'état applicatif ne
   * doit jamais prétendre qu'un accès existe côté réseau alors qu'il n'existe pas).
   */
  async create(dto: CreateSubscriptionDto, adminUserId?: string): Promise<Subscription> {
    const [customer, plan] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: dto.customerId } }),
      this.prisma.plan.findUnique({ where: { id: dto.planId } }),
    ]);
    if (!customer) throw new NotFoundException(`Client ${dto.customerId} introuvable`);
    if (!plan) throw new NotFoundException(`Offre ${dto.planId} introuvable`);
    if (plan.kind !== 'SUBSCRIPTION' || !plan.subscriptionPeriodDays) {
      throw new ConflictException(`L'offre "${plan.name}" n'est pas un abonnement récurrent`);
    }

    const routerId = dto.routerId ?? (await this.clients.getDefaultRouterId());
    const duplicate = await this.prisma.subscription.findUnique({
      where: { routerId_hotspotUsername: { routerId, hotspotUsername: dto.hotspotUsername } },
    });
    if (duplicate) {
      throw new ConflictException(`Le compte "${dto.hotspotUsername}" est déjà suivi sur ce routeur`);
    }

    const mikrotik = await this.clients.forRouter(routerId);
    await mikrotik.createHotspotUser({
      username: dto.hotspotUsername,
      password: dto.password,
      profileName: plan.mikrotikProfileName,
      comment: customer.name,
    });

    const start = new Date();
    const end = addDays(start, plan.subscriptionPeriodDays);
    const subscription = await this.prisma.subscription.create({
      data: {
        customerId: customer.id,
        planId: plan.id,
        routerId,
        hotspotUsername: dto.hotspotUsername,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        graceEndsAt: addDays(end, GRACE_PERIOD_DAYS),
      },
    });

    await this.audit.log({
      adminUserId,
      routerId,
      action: 'CREATE_SUBSCRIPTION',
      targetType: 'Subscription',
      targetId: subscription.id,
      payloadDiff: { customerId: customer.id, planId: plan.id, username: dto.hotspotUsername },
    });
    return subscription;
  }

  /**
   * Prolonge l'abonnement d'une période et réactive l'accès si besoin. La
   * nouvelle période part de la fin de l'ancienne tant qu'elle n'est pas
   * dépassée : un client qui paie en avance ne perd pas les jours restants.
   */
  async renew(subscriptionId: string, payment?: Payment, adminUserId?: string): Promise<Subscription> {
    const subscription = await this.findOne(subscriptionId);
    const plan = await this.prisma.plan.findUnique({ where: { id: subscription.planId } });
    if (!plan?.subscriptionPeriodDays) {
      throw new ConflictException(`L'offre de l'abonnement ${subscriptionId} n'a pas de période définie`);
    }

    const now = new Date();
    const start = subscription.currentPeriodEnd > now ? subscription.currentPeriodEnd : now;
    const end = addDays(start, plan.subscriptionPeriodDays);

    if (subscription.status === SubscriptionStatus.SUSPENDED) {
      await this.pushAccessState(subscription, true, adminUserId);
    }

    const renewed = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: end,
        graceEndsAt: addDays(end, GRACE_PERIOD_DAYS),
        suspendedAt: null,
        ...(payment ? { payments: { connect: { id: payment.id } } } : {}),
      },
    });

    await this.audit.log({
      adminUserId,
      routerId: subscription.routerId,
      action: 'RENEW_SUBSCRIPTION',
      targetType: 'Subscription',
      targetId: subscriptionId,
      payloadDiff: { newPeriodEnd: end.toISOString(), paymentId: payment?.id ?? null },
    });
    return renewed;
  }

  async suspend(id: string, adminUserId?: string): Promise<Subscription> {
    const subscription = await this.findOne(id);
    if (subscription.status === SubscriptionStatus.SUSPENDED) {
      throw new ConflictException(`L'abonnement ${id} est déjà suspendu`);
    }

    await this.pushAccessState(subscription, false, adminUserId);

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { status: SubscriptionStatus.SUSPENDED, suspendedAt: new Date() },
    });
    await this.audit.log({
      adminUserId,
      routerId: subscription.routerId,
      action: 'SUSPEND_SUBSCRIPTION',
      targetType: 'Subscription',
      targetId: id,
      payloadDiff: { username: subscription.hotspotUsername },
    });
    return updated;
  }

  async resume(id: string, adminUserId?: string): Promise<Subscription> {
    const subscription = await this.findOne(id);
    await this.pushAccessState(subscription, true, adminUserId);

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { status: this.deriveStatus(subscription), suspendedAt: null },
    });
    await this.audit.log({
      adminUserId,
      routerId: subscription.routerId,
      action: 'RESUME_SUBSCRIPTION',
      targetType: 'Subscription',
      targetId: id,
      payloadDiff: { username: subscription.hotspotUsername },
    });
    return updated;
  }

  /**
   * Abonnements à traiter, classés par urgence. Rien n'est appliqué
   * automatiquement : la suspension reste une décision de l'administration,
   * l'application se contente de la recommander.
   */
  async getRecommendations(): Promise<SubscriptionRecommendation[]> {
    const candidates = await this.prisma.subscription.findMany({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE] },
        currentPeriodEnd: { lte: addDays(new Date(), GRACE_PERIOD_DAYS) },
      },
      orderBy: { currentPeriodEnd: 'asc' },
    });

    const now = Date.now();
    return candidates.map((subscription) => {
      const daysRemaining = Math.ceil((subscription.currentPeriodEnd.getTime() - now) / DAY_MS);
      if (subscription.graceEndsAt.getTime() < now) {
        return { subscription, daysRemaining, reason: 'GRACE_ENDED', recommendedAction: 'SUSPEND' };
      }
      if (daysRemaining <= 0) {
        return { subscription, daysRemaining, reason: 'IN_GRACE', recommendedAction: 'WARN_CUSTOMER' };
      }
      return { subscription, daysRemaining, reason: 'EXPIRING_SOON', recommendedAction: 'WARN_CUSTOMER' };
    });
  }

  /** Statut dérivé des dates — la vérité vient de PostgreSQL, pas du routeur. */
  private deriveStatus(subscription: Subscription): SubscriptionStatus {
    const now = new Date();
    if (subscription.currentPeriodEnd > now) return SubscriptionStatus.ACTIVE;
    if (subscription.graceEndsAt > now) return SubscriptionStatus.GRACE;
    return SubscriptionStatus.GRACE;
  }

  /**
   * Applique l'accès sur le routeur : compte HotSpot activé/désactivé, et
   * appareils en contournement basculés `bypassed` ↔ `blocked` (décision
   * utilisateur : un appareil suspendu est bloqué, pas seulement renvoyé
   * vers le portail).
   */
  private async pushAccessState(
    subscription: Subscription,
    allowed: boolean,
    adminUserId?: string,
  ): Promise<void> {
    const mikrotik = await this.clients.forRouter(subscription.routerId);

    try {
      await mikrotik.setHotspotUserDisabled(subscription.hotspotUsername, !allowed);
    } catch (error) {
      // Compte absent du routeur : on le signale sans bloquer la mise à jour
      // du suivi en base, sinon l'abonnement resterait éternellement actif.
      if (!(error instanceof MikrotikNotFoundError)) throw error;
      await this.audit.log({
        adminUserId,
        routerId: subscription.routerId,
        action: allowed ? 'RESUME_SUBSCRIPTION' : 'SUSPEND_SUBSCRIPTION',
        targetType: 'Subscription',
        targetId: subscription.id,
        payloadDiff: { warning: `compte HotSpot "${subscription.hotspotUsername}" absent du routeur` },
        result: 'FAILURE',
      });
    }

    const devices = await this.prisma.device.findMany({
      where: { subscriptionId: subscription.id, mikrotikBindingId: { not: null } },
    });
    for (const device of devices) {
      await mikrotik.setIpBindingType(device.mikrotikBindingId!, allowed ? 'bypassed' : 'blocked');
      await this.prisma.device.update({
        where: { id: device.id },
        data: { bypassEnabled: allowed },
      });
    }
  }
}
