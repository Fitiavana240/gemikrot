import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  IMikrotikService,
  UserManagerLimitationDto,
  UserManagerProfileDto,
  UserManagerUserProfileState,
} from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { RouterAccessService } from '../routers/router-access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import { parseRouterTime } from '../routers/router-time.util.js';
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

/**
 * Parmi les attributions d'un compte, celle qui décrit son accès courant.
 *
 * Un compte en porte une par achat : au rachat, RouterOS en ajoute une et
 * laisse les précédentes à l'état `used`. La plus récente n'est pas
 * nécessairement la bonne non plus — une attribution `running-active` sans
 * échéance (profil illimité) prime sur une attribution périmée créée après.
 */
function pickGoverningAssignment<T extends { state: string; endTime: string | null }>(
  assignments: T[],
  gmtOffset: string,
): T | undefined {
  if (assignments.length <= 1) return assignments[0];

  const active = assignments.find((a) => a.state === 'running-active');
  if (active) return active;

  const waiting = assignments.find((a) => a.state === 'waiting');
  if (waiting) return waiting;

  // Que des attributions consommées : la dernière à expirer est celle qui a
  // donné son accès au client le plus récemment.
  return [...assignments].sort((a, b) => {
    const left = parseRouterTime(a.endTime, gmtOffset)?.getTime() ?? 0;
    const right = parseRouterTime(b.endTime, gmtOffset)?.getTime() ?? 0;
    return right - left;
  })[0];
}

/** D'où vient un compte trouvé sur le routeur. */
export type AccountSource = 'TICKET' | 'ABONNEMENT' | 'HORS_APPLICATION';

export interface AccountView {
  username: string;
  disabled: boolean;
  sharedUsers: number;
  comment: string | null;
  profileName: string | null;
  /** Échéance en instant absolu (ISO), convertie depuis le fuseau du routeur. */
  endTime: string | null;
  state: UserManagerUserProfileState | null;
  /** Nombre d'attributions portées par ce compte : un rachat en ajoute une. */
  assignmentCount: number;
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
  /** Attributions désignant un compte disparu du routeur. */
  attributionsOrphelines: number;
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
    private readonly access: RouterAccessService,
  ) {}

  // ==================== Profils ====================


  /**
   * Les sessions User Manager, celles que RADIUS a vues.
   *
   * A ne pas confondre avec les sessions HotSpot actives : celles-ci sont
   * l'historique des authentifications, y compris terminees. Une session
   * ouverte par cookie n'y figure pas — elle n'est jamais passee par RADIUS,
   * et c'est exactement ce qui rend la lecture des deux necessaire.
   */

  /** Clients RADIUS declares. Le secret partage ne sort jamais du paquet. */
  async routers(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getUmRouters();
  }

  /** Groupes d'authentification : methodes acceptees dedans et dehors. */
  async userGroups(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getUmUserGroups();
  }

  /** Attributs RADIUS connus du routeur, standards et constructeurs. */
  async attributes(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getUmAttributes();
  }

  async sessions(username?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getUserManagerSessions(username);
  }

  /**
   * Les paiements notes par le routeur lui-meme.
   *
   * A ne pas confondre avec l'ecran Paiements de l'application, qui est la
   * source de verite commerciale. Ceci n'est que la fonction de paiement
   * integree de RouterOS, que le parc n'utilise pas : il encaisse par Mobile
   * Money, hors du routeur. La table sera donc vide, et c'est normal.
   */
  async payments(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getUserManagerPayments();
  }

  /**
   * Les attributions profil/compte.
   *
   * C'est ici que vit l'echeance reelle : `end-time` est calendaire et tenu
   * par le routeur, qui l'applique meme application arretee. Un compte peut
   * en porter plusieurs — un rachat en ajoute une, il ne remplace pas la
   * precedente.
   */
  async assignments(username?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getUserManagerUserProfiles(username);
  }

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
        // Les attributions orphelines sont exclues du compte : elles désignent
        // des comptes qui n'existent plus, et le profil annonçait « 16 comptes »
        // pour seize fantômes. Elles sont dites à part, pas noyées dans le total.
        accountCount: new Set(
          assignments
            .filter((a) => a.profileName === profile.name && !a.usernameIntrouvable)
            .map((a) => a.username),
        ).size,
        attributionsOrphelines: assignments.filter(
          (a) => a.profileName === profile.name && a.usernameIntrouvable,
        ).length,
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
      nameForUsers: dto.nameForUsers,
      comment: dto.comment,
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

    // Un compte peut porter plusieurs attributions : chaque achat en ajoute
    // une, et les précédentes restent, à l'état `used`. Le routeur en a par
    // exemple deux pour `test1h`. En retenir une au hasard afficherait une
    // échéance périmée comme si elle était courante.
    const assignmentsByUser = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const list = assignmentsByUser.get(assignment.username) ?? [];
      list.push(assignment);
      assignmentsByUser.set(assignment.username, list);
    }

    const { gmtOffset } = await mikrotik.getClock();

    return users.map((user) => {
      const voucher = voucherByCode.get(user.username);
      const subscription = subscriptionByUsername.get(user.username);
      const userAssignments = assignmentsByUser.get(user.username) ?? [];
      const assignment = pickGoverningAssignment(userAssignments, gmtOffset);

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
        endTime: parseRouterTime(assignment?.endTime, gmtOffset)?.toISOString() ?? null,
        state: assignment?.state ?? null,
        assignmentCount: userAssignments.length,
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

  /**
   * Suspendre suppose trois gestes, pas un.
   *
   * Désactiver le compte ne coupe rien tout de suite : la session en cours
   * n'est pas fermée, et le profil serveur de ce parc accepte `mac-cookie`
   * avec une durée de vie de **trois jours** — le client se reconnecte alors
   * sans repasser par RADIUS, donc sans que le compte désactivé soit
   * consulté. Le travail planifié le savait et appelait `revoke` ; le bouton,
   * non. **L'exploitant qui cliquait obtenait une coupure plus faible que
   * celle qui serait arrivée toute seule quelques heures plus tard.**
   *
   * Ce qui a été réellement coupé est rendu à l'appelant : promettre une
   * coupure sans dire ce qu'elle a atteint, c'est ce défaut en plus petit.
   */
  async setAccountDisabled(
    username: string,
    disabled: boolean,
    adminUserId?: string,
    routerId?: string,
  ) {
    const mikrotik = await this.client(routerId);
    if (!disabled) {
      const user = await mikrotik.setUserManagerUserDisabled(username, false);
      await this.log(adminUserId, 'ENABLE_UM_USER', username);
      return { ...user, coupure: null };
    }

    // La désactivation d'abord, parce qu'elle seule rend le compte — il n'y a
    // pas de lecture unitaire dans l'interface du paquet. `revoke` ne la
    // refait donc pas.
    const user = await mikrotik.setUserManagerUserDisabled(username, true);
    const coupure = await this.access.revoke(mikrotik, username, { disableAccount: false });
    await this.log(adminUserId, 'DISABLE_UM_USER', username, { ...coupure });
    return { ...user, coupure };
  }

  /**
   * Supprimer suppose de couper d'abord.
   *
   * Effacer le compte ne ferme pas la session en cours et ne touche pas aux
   * cookies : le client reste en ligne, et son `mac-cookie` peut le ramèner.
   * C'est pire que le blocage, qui coupe désormais — une fois le compte
   * disparu, **il n'y a plus de nom à qui rattacher la coupure**, donc plus
   * moyen de rattraper l'oubli depuis cette console.
   *
   * L'ordre compte : couper tant que le compte existe, supprimer ensuite.
   */
  async deleteAccount(username: string, adminUserId?: string, routerId?: string): Promise<void> {
    const mikrotik = await this.client(routerId);
    await this.access.revoke(mikrotik, username, { disableAccount: false });
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
