import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  IMikrotikService,
  UserManagerLimitationDto,
  UserManagerProfileDto,
  UserManagerUserProfileState,
} from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import type {
  AssignProfileDto,
  AttachLimitationDto,
  CreateAccountDto,
  CreateLimitationDto,
  CreateUserManagerProfileDto,
  UpdateAccountDto,
  UpdateLimitationDto,
  UpdateUserManagerProfileDto,
} from './dto/user-manager.dto.js';

/** D'où vient un compte trouvé sur le routeur. */
export type AccountSource = 'TICKET' | 'ABONNEMENT' | 'HORS_APPLICATION';

export interface AccountView {
  username: string;
  disabled: boolean;
  sharedUsers: number;
  comment: string | null;
  profileName: string | null;
  endTime: string | null;
  state: UserManagerUserProfileState | null;
  source: AccountSource;
  customerName: string | null;
  voucherId: string | null;
  subscriptionId: string | null;
}

export interface ProfileView extends UserManagerProfileDto {
  /** Offre correspondante, quand ce profil est piloté par l'application. */
  planId: string | null;
  planName: string | null;
  limitationNames: string[];
  accountCount: number;
}

/**
 * Administration directe de User Manager : profils, limitations et comptes
 * tels qu'ils existent sur le routeur, enrichis de ce que l'application en
 * sait.
 *
 * Le routeur fait foi pour ce qui existe. Un compte présent sur le routeur
 * sans ligne correspondante en base est affiché comme tel — étiqueté
 * `HORS_APPLICATION` — et jamais rattaché d'office à un client : sur un
 * routeur qui portait déjà des comptes avant l'application, deviner serait
 * inventer.
 */
@Injectable()
export class UserManagerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: MikrotikClientFactory,
    private readonly audit: AuditService,
  ) {}

  // ==================== Profils ====================

  async listProfiles(routerId?: string): Promise<ProfileView[]> {
    const mikrotik = await this.client(routerId);
    const [profiles, junctions, assignments, plans] = await Promise.all([
      mikrotik.getUserManagerProfiles(),
      mikrotik.getUserManagerProfileLimitations(),
      mikrotik.getUserManagerUserProfiles(),
      this.prisma.scopedStrict.plan.findMany({
        select: { id: true, name: true, umProfileName: true },
      }),
    ]);

    const planByProfile = new Map(
      plans.filter((p) => p.umProfileName).map((p) => [p.umProfileName!, p]),
    );

    return profiles.map((profile) => {
      const plan = planByProfile.get(profile.name) ?? null;
      return {
        ...profile,
        planId: plan?.id ?? null,
        planName: plan?.name ?? null,
        limitationNames: junctions
          .filter((j) => j.profileName === profile.name)
          .map((j) => j.limitationName),
        accountCount: assignments.filter((a) => a.profileName === profile.name).length,
      };
    });
  }

  async createProfile(
    dto: CreateUserManagerProfileDto,
    adminUserId?: string,
    routerId?: string,
  ): Promise<UserManagerProfileDto> {
    const mikrotik = await this.client(routerId);
    const profile = await mikrotik.createProfile({
      name: dto.name,
      validityDurationSeconds: dto.validityDurationSeconds ?? null,
      startsWhen: dto.startsWhen,
      price: dto.price,
      sharedUsers: dto.sharedUsers,
    });
    await this.log(adminUserId, 'CREATE_UM_PROFILE', profile.name, { ...dto });
    return profile;
  }

  async updateProfile(
    name: string,
    dto: UpdateUserManagerProfileDto,
    adminUserId?: string,
    routerId?: string,
  ): Promise<UserManagerProfileDto> {
    const mikrotik = await this.client(routerId);
    const profile = await mikrotik.updateProfile({ name, ...dto });
    await this.log(adminUserId, 'UPDATE_UM_PROFILE', name, { ...dto });
    return profile;
  }

  async deleteProfile(name: string, adminUserId?: string, routerId?: string): Promise<void> {
    const mikrotik = await this.client(routerId);
    await mikrotik.deleteProfile(name);
    await this.log(adminUserId, 'DELETE_UM_PROFILE', name);
  }

  // ==================== Limitations ====================

  async listLimitations(routerId?: string): Promise<(UserManagerLimitationDto & { profileNames: string[] })[]> {
    const mikrotik = await this.client(routerId);
    const [limitations, junctions] = await Promise.all([
      mikrotik.getUserManagerLimitations(),
      mikrotik.getUserManagerProfileLimitations(),
    ]);

    return limitations.map((limitation) => ({
      ...limitation,
      profileNames: junctions
        .filter((j) => j.limitationName === limitation.name)
        .map((j) => j.profileName),
    }));
  }

  async createLimitation(
    dto: CreateLimitationDto,
    adminUserId?: string,
    routerId?: string,
  ): Promise<UserManagerLimitationDto> {
    const mikrotik = await this.client(routerId);
    const limitation = await mikrotik.createLimitation(dto);
    await this.log(adminUserId, 'CREATE_UM_LIMITATION', limitation.name, { ...dto });
    return limitation;
  }

  async updateLimitation(
    name: string,
    dto: UpdateLimitationDto,
    adminUserId?: string,
    routerId?: string,
  ): Promise<UserManagerLimitationDto> {
    const mikrotik = await this.client(routerId);
    const limitation = await mikrotik.updateLimitation({ name, ...dto });
    await this.log(adminUserId, 'UPDATE_UM_LIMITATION', name, { ...dto });
    return limitation;
  }

  async deleteLimitation(name: string, adminUserId?: string, routerId?: string): Promise<void> {
    const mikrotik = await this.client(routerId);
    await mikrotik.deleteLimitation(name);
    await this.log(adminUserId, 'DELETE_UM_LIMITATION', name);
  }

  async attachLimitation(
    profileName: string,
    dto: AttachLimitationDto,
    adminUserId?: string,
    routerId?: string,
  ) {
    const mikrotik = await this.client(routerId);
    const junction = await mikrotik.attachLimitationToProfile({
      profileName,
      limitationName: dto.limitationName,
    });
    await this.log(adminUserId, 'ATTACH_UM_LIMITATION', profileName, {
      limitationName: dto.limitationName,
    });
    return junction;
  }

  async detachLimitation(
    profileName: string,
    limitationName: string,
    adminUserId?: string,
    routerId?: string,
  ): Promise<void> {
    const mikrotik = await this.client(routerId);
    await mikrotik.detachLimitationFromProfile({ profileName, limitationName });
    await this.log(adminUserId, 'DETACH_UM_LIMITATION', profileName, { limitationName });
  }

  // ==================== Comptes ====================

  /**
   * Tous les comptes User Manager du routeur, rapprochés de ce que
   * l'application connaît. C'est la vue « tous les comptes créés » : elle
   * part du routeur, pas de la base, pour qu'un compte créé hors application
   * y apparaisse aussi.
   */
  async listAccounts(routerId?: string): Promise<AccountView[]> {
    const mikrotik = await this.client(routerId);
    const [users, assignments] = await Promise.all([
      mikrotik.getUserManagerUsers(),
      mikrotik.getUserManagerUserProfiles(),
    ]);

    const usernames = users.map((u) => u.username);
    const [vouchers, subscriptions] = await Promise.all([
      this.prisma.scopedStrict.voucher.findMany({
        where: { code: { in: usernames } },
        select: { id: true, code: true, customer: { select: { name: true } } },
      }),
      this.prisma.scopedStrict.subscription.findMany({
        where: { hotspotUsername: { in: usernames } },
        select: { id: true, hotspotUsername: true, customer: { select: { name: true } } },
      }),
    ]);

    const voucherByCode = new Map(vouchers.map((v) => [v.code, v]));
    const subscriptionByUsername = new Map(subscriptions.map((s) => [s.hotspotUsername, s]));
    const assignmentByUser = new Map(assignments.map((a) => [a.username, a]));

    return users.map((user) => {
      const voucher = voucherByCode.get(user.username);
      const subscription = subscriptionByUsername.get(user.username);
      const assignment = assignmentByUser.get(user.username);

      // L'abonnement prime : un compte suivi comme abonnement l'est
      // explicitement, alors qu'un code de ticket pourrait coïncider.
      const source: AccountSource = subscription
        ? 'ABONNEMENT'
        : voucher
          ? 'TICKET'
          : 'HORS_APPLICATION';

      return {
        username: user.username,
        disabled: user.disabled,
        sharedUsers: user.sharedUsers,
        comment: user.comment,
        profileName: assignment?.profileName ?? null,
        endTime: assignment?.endTime ?? null,
        state: assignment?.state ?? null,
        source,
        customerName: subscription?.customer?.name ?? voucher?.customer?.name ?? null,
        voucherId: voucher?.id ?? null,
        subscriptionId: subscription?.id ?? null,
      };
    });
  }

  async createAccount(dto: CreateAccountDto, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    const user = await mikrotik.createUserManagerUser({
      username: dto.username,
      password: dto.password,
      sharedUsers: dto.sharedUsers,
      comment: dto.comment,
    });
    if (dto.profileName) {
      await mikrotik.assignProfile({ username: dto.username, profileName: dto.profileName });
    }
    await this.log(adminUserId, 'CREATE_UM_USER', dto.username, {
      profileName: dto.profileName ?? null,
    });
    return user;
  }

  async updateAccount(
    username: string,
    dto: UpdateAccountDto,
    adminUserId?: string,
    routerId?: string,
  ) {
    const mikrotik = await this.client(routerId);
    const user = await mikrotik.updateUserManagerUser({ username, ...dto });
    // Le mot de passe n'est jamais recopié dans le journal d'audit.
    await this.log(adminUserId, 'UPDATE_UM_USER', username, {
      passwordChanged: dto.password !== undefined,
      sharedUsers: dto.sharedUsers ?? null,
    });
    return user;
  }

  async setAccountDisabled(
    username: string,
    disabled: boolean,
    adminUserId?: string,
    routerId?: string,
  ) {
    const mikrotik = await this.client(routerId);
    const user = await mikrotik.setUserManagerUserDisabled(username, disabled);
    await this.log(adminUserId, disabled ? 'DISABLE_UM_USER' : 'ENABLE_UM_USER', username);
    return user;
  }

  async deleteAccount(username: string, adminUserId?: string, routerId?: string): Promise<void> {
    const mikrotik = await this.client(routerId);
    await mikrotik.deleteUserManagerUser(username);
    await this.log(adminUserId, 'DELETE_UM_USER', username);
  }

  async assignProfile(
    username: string,
    dto: AssignProfileDto,
    adminUserId?: string,
    routerId?: string,
  ) {
    const mikrotik = await this.client(routerId);
    const assignment = await mikrotik.assignProfile({ username, profileName: dto.profileName });
    await this.log(adminUserId, 'ASSIGN_UM_PROFILE', username, { profileName: dto.profileName });
    return assignment;
  }

  async removeProfile(
    username: string,
    profileName: string,
    adminUserId?: string,
    routerId?: string,
  ): Promise<void> {
    const mikrotik = await this.client(routerId);
    await mikrotik.removeProfile({ username, profileName });
    await this.log(adminUserId, 'REMOVE_UM_PROFILE', username, { profileName });
  }

  /**
   * Le routeur est toujours résolu par le client cloisonné : un identifiant
   * venu de l'URL ne peut donc pas désigner le routeur d'un autre exploitant.
   */
  private async client(routerId?: string): Promise<IMikrotikService> {
    if (!routerId) return this.clients.forDefaultRouter();

    const router = await this.prisma.scopedStrict.router.findUnique({ where: { id: routerId } });
    if (!router) throw new NotFoundException(`Routeur ${routerId} introuvable`);
    return this.clients.forRouter(router.id);
  }

  private log(
    adminUserId: string | undefined,
    action: string,
    targetId: string,
    payloadDiff?: Record<string, unknown>,
  ) {
    return this.audit.log({
      adminUserId,
      action,
      targetType: 'UserManager',
      targetId,
      payloadDiff: payloadDiff as never,
    });
  }
}
