import { Injectable } from '@nestjs/common';
import { DeviceType, PlanKind } from '@prisma/client';
import type { HotspotProfileDto, HotspotUserDto } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DeviceDetectionService } from '../devices/device-detection.service.js';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';

export interface ImportReport {
  routerId: string;
  dryRun: boolean;
  plans: { created: number; updated: number; needingPriceReview: number };
  customers: { created: number; matched: number };
  subscriptions: { created: number; updated: number };
  devices: { created: number; updated: number };
  /** Comptes non importés (profil inconnu, compte système…) et pourquoi. */
  skipped: { name: string; reason: string }[];
}

/** Offre résolue pour un profil RouterOS (`id` null en simulation). */
interface ResolvedPlan {
  id: string | null;
  kind: PlanKind;
  periodDays: number | null;
}

/** Profils RouterOS internes, qui ne correspondent à aucune offre vendue. */
const NON_COMMERCIAL_PROFILES = new Set(['default', 'default-trial', 'Admin', 'Admin2']);

/** Un mois commercial chez WIFI-TATI : les profils "1Mois" durent 4w2d. */
const MONTH_DAYS = 30;

@Injectable()
export class RouterImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clients: MikrotikClientFactory,
    private readonly detection: DeviceDetectionService,
  ) {}

  /**
   * Recopie en base l'état du routeur : profils → offres, comptes → clients +
   * abonnements, ip-bindings → appareils. Idempotent, et **n'écrit jamais sur
   * le routeur**. `dryRun` permet de voir ce qui serait importé.
   */
  async importFromRouter(
    routerId: string,
    options: { dryRun?: boolean; adminUserId?: string } = {},
  ): Promise<ImportReport> {
    const dryRun = options.dryRun ?? false;
    const mikrotik = await this.clients.forRouter(routerId);

    const [profiles, users, bindings, leases] = await Promise.all([
      mikrotik.getHotspotProfiles(),
      mikrotik.getHotspotUsers(),
      mikrotik.getIpBindings(),
      mikrotik.getDhcpLeases(),
    ]);

    const report: ImportReport = {
      routerId,
      dryRun,
      plans: { created: 0, updated: 0, needingPriceReview: 0 },
      customers: { created: 0, matched: 0 },
      subscriptions: { created: 0, updated: 0 },
      devices: { created: 0, updated: 0 },
      skipped: [],
    };

    const plansByProfile = await this.importProfiles(profiles, report, dryRun);
    await this.importUsers(users, plansByProfile, routerId, report, dryRun);
    await this.importBindings(bindings, leases, routerId, report, dryRun);

    if (!dryRun) {
      await this.audit.log({
        adminUserId: options.adminUserId,
        routerId,
        action: 'IMPORT_ROUTER_STATE',
        targetType: 'Router',
        targetId: routerId,
        payloadDiff: { ...report } as never,
      });
    }
    return report;
  }

  private async importProfiles(
    profiles: HotspotProfileDto[],
    report: ImportReport,
    dryRun: boolean,
  ): Promise<Map<string, ResolvedPlan>> {
    // En simulation, aucune offre n'est écrite : la correspondance est tout
    // de même construite en mémoire, sinon aucun abonné ne serait projeté.
    const plansByProfile = new Map<string, ResolvedPlan>();

    for (const profile of profiles) {
      if (NON_COMMERCIAL_PROFILES.has(profile.name)) {
        report.skipped.push({ name: profile.name, reason: 'profil interne, non commercial' });
        continue;
      }

      const priceAr = this.guessPriceFromName(profile.name);
      const periodDays = this.guessSubscriptionPeriod(profile);
      const existing = await this.prisma.plan.findUnique({
        where: { mikrotikProfileName: profile.name },
      });

      if (priceAr === null) report.plans.needingPriceReview += 1;

      const data = {
        name: profile.name,
        priceAr: priceAr ?? 0,
        priceNeedsReview: priceAr === null,
        validityDurationSeconds: profile.sessionTimeoutSeconds ?? 3600,
        sessionTimeoutSeconds: profile.sessionTimeoutSeconds,
        rateLimitRxBps: profile.rateLimitRxBitsPerSecond,
        rateLimitTxBps: profile.rateLimitTxBitsPerSecond,
        maxSharedUsers: profile.sharedUsers,
        kind: periodDays ? PlanKind.SUBSCRIPTION : PlanKind.TICKET,
        subscriptionPeriodDays: periodDays,
        mikrotikProfileName: profile.name,
      };

      if (dryRun) {
        existing ? (report.plans.updated += 1) : (report.plans.created += 1);
        plansByProfile.set(profile.name, {
          id: existing?.id ?? null,
          kind: data.kind,
          periodDays: periodDays,
        });
        continue;
      }

      const plan = existing
        ? await this.prisma.plan.update({
            where: { id: existing.id },
            // Le prix saisi par un admin prime sur la déduction depuis le nom.
            data: { ...data, priceAr: existing.priceNeedsReview ? data.priceAr : existing.priceAr },
          })
        : await this.prisma.plan.create({ data });

      existing ? (report.plans.updated += 1) : (report.plans.created += 1);
      plansByProfile.set(profile.name, {
        id: plan.id,
        kind: plan.kind,
        periodDays: plan.subscriptionPeriodDays,
      });
    }

    return plansByProfile;
  }

  private async importUsers(
    users: HotspotUserDto[],
    plansByProfile: Map<string, ResolvedPlan>,
    routerId: string,
    report: ImportReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const user of users) {
      const plan = plansByProfile.get(user.profile);
      if (!plan) {
        report.skipped.push({
          name: user.username,
          reason: user.profile ? `profil "${user.profile}" non commercial` : 'aucun profil',
        });
        continue;
      }

      // Seuls les abonnements sont suivis dans le temps : les tickets sont
      // consommés à l'usage et n'ont pas de période à renouveler.
      if (plan.kind !== PlanKind.SUBSCRIPTION) {
        report.skipped.push({ name: user.username, reason: 'compte à ticket, pas un abonnement' });
        continue;
      }

      if (dryRun || !plan.id) {
        report.subscriptions.created += 1;
        continue;
      }

      const planId = plan.id;
      const customerName = user.comment?.trim() || user.username;
      const customer = await this.findOrCreateCustomer(customerName, user.username, report);

      const existing = await this.prisma.subscription.findUnique({
        where: { routerId_hotspotUsername: { routerId, hotspotUsername: user.username } },
      });

      if (existing) {
        await this.prisma.subscription.update({
          where: { id: existing.id },
          data: { planId, status: user.disabled ? 'SUSPENDED' : existing.status },
        });
        report.subscriptions.updated += 1;
        continue;
      }

      // Le routeur ne connaît aucune date : on ouvre une période à partir de
      // maintenant, à corriger par l'admin si la vraie échéance diffère.
      const start = new Date();
      const end = new Date(start.getTime() + (plan.periodDays ?? MONTH_DAYS) * 86_400_000);
      await this.prisma.subscription.create({
        data: {
          customerId: customer.id,
          planId,
          routerId,
          hotspotUsername: user.username,
          status: user.disabled ? 'SUSPENDED' : 'ACTIVE',
          suspendedAt: user.disabled ? new Date() : null,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          graceEndsAt: new Date(end.getTime() + 7 * 86_400_000),
        },
      });
      report.subscriptions.created += 1;
    }
  }

  private async importBindings(
    bindings: { id: string; macAddress: string; type: string; comment: string | null }[],
    leases: { macAddress: string; hostName: string | null; address: string }[],
    routerId: string,
    report: ImportReport,
    dryRun: boolean,
  ): Promise<void> {
    const leaseByMac = new Map(leases.map((lease) => [lease.macAddress.toUpperCase(), lease]));

    for (const binding of bindings) {
      if (dryRun) {
        report.devices.created += 1;
        continue;
      }

      const lease = leaseByMac.get(binding.macAddress.toUpperCase());
      const detected = this.detection.detect({
        macAddress: binding.macAddress,
        hostname: lease?.hostName,
        // Le commentaire manuel ("Smart TV Samsung - Client Dalia") est plus
        // parlant que le nom DHCP, souvent absent sur ce type d'appareil.
        comment: binding.comment,
      });

      const existing = await this.prisma.device.findFirst({
        where: { macAddress: binding.macAddress, routerId },
      });

      const data = {
        macAddress: binding.macAddress,
        routerId,
        ipAddress: lease?.address ?? null,
        hostname: lease?.hostName ?? null,
        detectedType: detected.type,
        detectionSource: detected.source,
        bypassEnabled: binding.type === 'bypassed',
        mikrotikBindingId: binding.id,
      };

      if (existing) {
        await this.prisma.device.update({ where: { id: existing.id }, data });
        report.devices.updated += 1;
      } else {
        await this.prisma.device.create({
          data: { ...data, type: detected.confidence === 'high' ? detected.type : DeviceType.OTHER },
        });
        report.devices.created += 1;
      }
    }
  }

  private async findOrCreateCustomer(name: string, username: string, report: ImportReport) {
    const existing = await this.prisma.customer.findFirst({ where: { name } });
    if (existing) {
      report.customers.matched += 1;
      return existing;
    }
    report.customers.created += 1;
    // Le routeur ne stocke aucun téléphone : un identifiant provisoire est
    // posé pour satisfaire la contrainte d'unicité, à compléter par l'admin.
    return this.prisma.customer.create({
      data: { name, phone: `import:${username}` },
    });
  }

  /** "1Mois-15000Ar" → 15000. Retourne null si le nom ne dit rien du prix. */
  private guessPriceFromName(profileName: string): number | null {
    const match = profileName.match(/(\d+)\s*Ar/i);
    return match ? Number(match[1]) : null;
  }

  /** "1Mois-15000Ar" → 30 jours. Null pour une offre à ticket. */
  private guessSubscriptionPeriod(profile: HotspotProfileDto): number | null {
    if (/mois/i.test(profile.name)) return MONTH_DAYS;
    if (/semaine/i.test(profile.name)) return 7;
    // Un "Ticket ... Appareils" facturé au mois reste un abonnement : sa
    // durée de session dépasse la semaine.
    if ((profile.sessionTimeoutSeconds ?? 0) >= 28 * 86_400) return MONTH_DAYS;
    return null;
  }
}
