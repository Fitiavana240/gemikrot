import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Plan } from '@prisma/client';
import type { IMikrotikService } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';

/** Ce qu'une réconciliation a réellement fait, pour l'afficher à l'admin. */
export interface ReconcileReport {
  profileName: string;
  limitationName: string | null;
  actions: string[];
}

/** Contraintes de nommage de RouterOS, reprises des schémas du paquet. */
const ROUTEROS_NAME = /^[a-zA-Z0-9_.-]{2,64}$/;

/**
 * Projette une offre commerciale sur User Manager : un profil portant la
 * validité calendaire, et, quand l'offre impose des plafonds, une limitation
 * rattachée par une jonction.
 *
 * **Ce service ne touche jamais au HotSpot local.** Il n'appelle aucune
 * méthode `createHotspotProfile`, `updateHotspotProfile` ni `*HotspotUser` :
 * les 646 comptes et les profils historiques du routeur ne doivent être
 * modifiés par aucun chemin nouveau.
 *
 * C'est aussi le seul endroit qui calcule la validité d'un profil User
 * Manager. Les abonnements passaient auparavant par leur propre routine :
 * deux chemins écrivaient le même profil avec des validités différentes, et
 * le dernier passé l'emportait sans que rien ne le signale.
 */
@Injectable()
export class PlanProvisioningService {
  private readonly logger = new Logger(PlanProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: MikrotikClientFactory,
  ) {}

  /**
   * Amène le routeur à l'état décrit par l'offre. Idempotent : rejouée sans
   * changement entre-temps, la réconciliation n'écrit rien.
   */
  async reconcile(planId: string, routerId?: string): Promise<ReconcileReport> {
    const plan = await this.prisma.scopedStrict.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Offre ${planId} introuvable`);

    const mikrotik = routerId
      ? await this.clients.forRouter(routerId)
      : await this.clients.forDefaultRouter();

    const actions: string[] = [];
    const profileName = this.resolveProfileName(plan);

    await this.reconcileProfile(mikrotik, plan, profileName, actions);
    const limitationName = await this.reconcileLimitation(mikrotik, plan, profileName, actions);

    await this.prisma.scopedStrict.plan.update({
      where: { id: plan.id },
      data: { umProfileName: profileName, umLimitationName: limitationName, umSyncedAt: new Date() },
    });

    return { profileName, limitationName, actions };
  }

  /** État vu du routeur, pour signaler une divergence sans rien écrire. */
  async inspect(planId: string, routerId?: string) {
    const plan = await this.prisma.scopedStrict.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Offre ${planId} introuvable`);

    const name = plan.umProfileName;
    if (!name) {
      return { status: 'absent' as const, profile: null, limitation: null, junction: false };
    }

    const mikrotik = routerId
      ? await this.clients.forRouter(routerId)
      : await this.clients.forDefaultRouter();

    const [profiles, limitations, junctions] = await Promise.all([
      mikrotik.getUserManagerProfiles(),
      mikrotik.getUserManagerLimitations(),
      mikrotik.getUserManagerProfileLimitations(),
    ]);

    const profile = profiles.find((p) => p.name === name) ?? null;
    const limitation = plan.umLimitationName
      ? limitations.find((l) => l.name === plan.umLimitationName) ?? null
      : null;
    const junction = plan.umLimitationName
      ? junctions.some((j) => j.profileName === name && j.limitationName === plan.umLimitationName)
      : true;

    const aligned =
      profile != null &&
      profile.validityDurationSeconds === this.expectedValidity(plan) &&
      (!plan.umLimitationName || (limitation != null && junction));

    return {
      status: profile
        ? aligned
          ? ('synchronise' as const)
          : ('divergent' as const)
        : ('absent' as const),
      profile,
      limitation,
      junction,
    };
  }

  private async reconcileProfile(
    mikrotik: IMikrotikService,
    plan: Plan,
    profileName: string,
    actions: string[],
  ): Promise<void> {
    const validityDurationSeconds = this.expectedValidity(plan);
    const startsWhen = plan.startsWhen === 'ASSIGNED' ? 'assigned' : 'first-auth';
    const sharedUsers = plan.maxSharedUsers ?? undefined;

    const existing = (await mikrotik.getUserManagerProfiles()).find((p) => p.name === profileName);
    if (!existing) {
      await mikrotik.createProfile({
        name: profileName,
        validityDurationSeconds,
        startsWhen,
        price: Number(plan.price),
        sharedUsers,
      });
      actions.push(`profil ${profileName} créé`);
      return;
    }

    const aligned =
      existing.validityDurationSeconds === validityDurationSeconds &&
      existing.startsWhen === startsWhen &&
      existing.price === Number(plan.price) &&
      existing.overrideSharedUsers === (plan.maxSharedUsers ?? null);
    if (aligned) return;

    await mikrotik.updateProfile({
      name: profileName,
      validityDurationSeconds,
      startsWhen,
      price: Number(plan.price),
      sharedUsers,
    });
    actions.push(`profil ${profileName} mis à jour`);
  }

  /** Renvoie le nom de la limitation en place, ou `null` s'il n'en faut pas. */
  private async reconcileLimitation(
    mikrotik: IMikrotikService,
    plan: Plan,
    profileName: string,
    actions: string[],
  ): Promise<string | null> {
    const wanted = {
      rateLimitRxBitsPerSecond: plan.rateLimitRxBps,
      rateLimitTxBitsPerSecond: plan.rateLimitTxBps,
      transferLimitBytes: plan.transferLimitBytes != null ? Number(plan.transferLimitBytes) : null,
    };
    const needed =
      wanted.rateLimitRxBitsPerSecond != null ||
      wanted.rateLimitTxBitsPerSecond != null ||
      wanted.transferLimitBytes != null;

    const limitationName = `${profileName}-LIM`.slice(0, 64);
    const existing = (await mikrotik.getUserManagerLimitations()).find(
      (l) => l.name === limitationName,
    );

    if (!needed) {
      // L'offre n'impose plus de plafond : la limitation est retirée, sinon
      // elle continuerait de s'appliquer en silence.
      if (existing) {
        await mikrotik
          .detachLimitationFromProfile({ profileName, limitationName })
          .catch(() => undefined);
        await mikrotik.deleteLimitation(limitationName);
        actions.push(`limitation ${limitationName} supprimée`);
      }
      return null;
    }

    if (!existing) {
      await mikrotik.createLimitation({ name: limitationName, ...wanted });
      actions.push(`limitation ${limitationName} créée`);
    } else {
      const aligned =
        existing.rateLimit.rxBitsPerSecond === wanted.rateLimitRxBitsPerSecond &&
        existing.rateLimit.txBitsPerSecond === wanted.rateLimitTxBitsPerSecond &&
        existing.transferLimitBytes === wanted.transferLimitBytes;
      if (!aligned) {
        await mikrotik.updateLimitation({ name: limitationName, ...wanted });
        actions.push(`limitation ${limitationName} mise à jour`);
      }
    }

    const junctions = await mikrotik.getUserManagerProfileLimitations();
    const already = junctions.some(
      (j) => j.profileName === profileName && j.limitationName === limitationName,
    );
    // Idempotent côté paquet : renvoie la jonction existante plutôt que d'en
    // créer une seconde, que RouterOS accepterait volontiers.
    await mikrotik.attachLimitationToProfile({ profileName, limitationName });
    if (!already) actions.push(`limitation rattachée à ${profileName}`);

    return limitationName;
  }

  /**
   * Un abonnement compte en périodes, un ticket en durée de validité. Les
   * deux finissent sur le même champ `validity` côté RouterOS.
   */
  private expectedValidity(plan: Plan): number {
    if (plan.kind === 'SUBSCRIPTION' && plan.subscriptionPeriodDays) {
      return plan.subscriptionPeriodDays * 86_400;
    }
    return plan.validityDurationSeconds;
  }

  /**
   * Le nom du profil HotSpot historique sert de base, mais il ne passe pas
   * toujours : les profils importés portent des noms qu'User Manager refuse,
   * et ce nom transite par l'URL REST.
   */
  private resolveProfileName(plan: Plan): string {
    const candidate = plan.umProfileName ?? plan.mikrotikProfileName;
    if (ROUTEROS_NAME.test(candidate)) return candidate;

    const cleaned = candidate
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
    if (!ROUTEROS_NAME.test(cleaned)) {
      throw new ConflictException(
        `Impossible de dériver un nom de profil User Manager depuis "${candidate}"`,
      );
    }
    this.logger.warn(`Nom de profil adapté pour User Manager : "${candidate}" -> "${cleaned}"`);
    return cleaned;
  }
}
