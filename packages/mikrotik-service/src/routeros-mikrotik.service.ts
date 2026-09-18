import { IMikrotikService } from './interfaces/mikrotik-service.interface';
import { RouterOSRestClient } from './client/routeros-rest-client';
import { ILogger } from './logging/logger.interface';
import * as RouterMapper from './mappers/router.mapper';
import * as HotspotMapper from './mappers/hotspot.mapper';
import * as UmMapper from './mappers/user-manager.mapper';
import { validate } from './validation/validate';
import {
  assignProfileSchema,
  attachLimitationSchema,
  createHotspotProfileSchema,
  createHotspotUserSchema,
  createIpBindingSchema,
  createLimitationSchema,
  createProfileSchema,
  createUserManagerUserSchema,
  disconnectHotspotUserSchema,
  hotspotUsernameParamSchema,
  ipBindingTypeSchema,
  limitationNameParamSchema,
  profileNameParamSchema,
  removeProfileAssignmentSchema,
  updateHotspotProfileSchema,
  updateHotspotUserSchema,
  updateLimitationSchema,
  updateProfileSchema,
  updateUserManagerUserSchema,
  usernameParamSchema,
} from './validation/schemas';
import {
  AssignProfileDto,
  AttachLimitationDto,
  CreateHotspotProfileDto,
  CreateHotspotUserDto,
  CreateIpBindingDto,
  CreateLimitationDto,
  CreateProfileDto,
  CreateUserManagerUserDto,
  DisconnectHotspotUserDto,
  RemoveProfileAssignmentDto,
  UpdateHotspotProfileDto,
  UpdateHotspotUserDto,
  UpdateLimitationDto,
  UpdateProfileDto,
  UpdateUserManagerUserDto,
} from './dto/commands.dto';
import { IpBindingType } from './dto/hotspot.dto';
import type { UserManagerUserDto } from './dto/user-manager.dto';
import { MikrotikConflictError, MikrotikNotFoundError } from './errors/mikrotik.errors';

/**
 * Corps d'écriture d'une limitation. Les champs sont ceux relevés sur un hAP
 * en 7.24.4 : `rate-limit-rx`/`rate-limit-tx` séparés et en bits par seconde
 * (et non un jeton « rx/tx » comme sur un profil HotSpot), `transfer-limit`
 * en octets, `uptime-limit` en durée.
 *
 * `null` veut dire « retirer le plafond » : RouterOS l'exprime par zéro, ce
 * qui permet de lever une limite existante sans supprimer la limitation.
 * `undefined` veut dire « ne pas toucher » et n'apparaît pas dans le corps.
 */
function buildLimitationPayload(data: Partial<CreateLimitationDto>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (data.rateLimitRxBitsPerSecond !== undefined) {
    payload['rate-limit-rx'] = data.rateLimitRxBitsPerSecond ?? 0;
  }
  if (data.rateLimitTxBitsPerSecond !== undefined) {
    payload['rate-limit-tx'] = data.rateLimitTxBitsPerSecond ?? 0;
  }
  if (data.transferLimitBytes !== undefined) {
    payload['transfer-limit'] = data.transferLimitBytes ?? 0;
  }
  if (data.uptimeLimitSeconds !== undefined) {
    payload['uptime-limit'] = data.uptimeLimitSeconds != null ? `${data.uptimeLimitSeconds}s` : '0s';
  }
  return payload;
}

/**
 * Implémentation concrète de `IMikrotikService` s'appuyant sur l'API REST
 * de RouterOS (`RouterOSRestClient`). C'est la SEULE classe du projet
 * autorisée à connaître à la fois :
 *  - le vocabulaire RouterOS (chemins `/rest/...`, champs kebab-case,
 *    via les mappers) ;
 *  - la sémantique métier de haut niveau (DTOs applicatifs, règles de
 *    validation, règles de conflit/existence).
 *
 * Toute nouvelle implémentation (ex : API binaire RouterOS pour les
 * endpoints encore mal couverts par REST en v7.24.4) doit être un autre
 * fichier implémentant la même interface, jamais une modification de
 * celle-ci en place.
 */
export class RouterOSMikrotikService implements IMikrotikService {
  constructor(private readonly client: RouterOSRestClient, private readonly logger: ILogger) {}

  // ==================== Système / monitoring ====================

  async getRouterIdentity() {
    const raw = await this.client.get<any>('/system/identity');
    return RouterMapper.mapRouterIdentity(raw);
  }

  async getSystemResource() {
    const raw = await this.client.get<any>('/system/resource');
    return RouterMapper.mapSystemResource(raw);
  }

  async getInterfaces() {
    const raw = await this.client.get<any[]>('/interface');
    return raw.map(RouterMapper.mapNetworkInterface);
  }

  async getClock() {
    const raw = await this.client.get<any>('/system/clock');
    return RouterMapper.mapClock(raw);
  }

  async getNtpStatus() {
    const raw = await this.client.get<any>('/system/ntp/client');
    return RouterMapper.mapNtpStatus(raw);
  }

  async getRadiusStatus() {
    // User Manager fait office de serveur RADIUS local : on vérifie sa
    // disponibilité en sondant un endpoint léger, sans lever d'exception
    // vers l'appelant si cette sonde échoue (c'est justement l'info
    // recherchée par l'appelant : "RADIUS est-il up ?").
    let userManagerReachable = true;
    try {
      await this.client.get<any[]>('/user-manager/user', { count: 1 });
    } catch {
      userManagerReachable = false;
    }
    const system = await this.client.get<any>('/system/resource');
    return RouterMapper.mapRadiusStatus(system, userManagerReachable);
  }

  // ==================== HotSpot ====================

  async getHotspotActiveUsers() {
    const raw = await this.client.get<any[]>('/ip/hotspot/active');
    return raw.map(HotspotMapper.mapHotspotActiveUser);
  }

  async getHotspotHosts() {
    const raw = await this.client.get<any[]>('/ip/hotspot/host');
    return raw.map(HotspotMapper.mapHotspotHost);
  }

  async getHotspotUsers() {
    const raw = await this.client.get<any[]>('/ip/hotspot/user');
    return raw.map(HotspotMapper.mapHotspotUser);
  }

  async getHotspotProfiles() {
    const raw = await this.client.get<any[]>('/ip/hotspot/user/profile');
    return raw.map(HotspotMapper.mapHotspotProfile);
  }

  async disconnectHotspotUser(input: DisconnectHotspotUserDto) {
    const data = validate(disconnectHotspotUserSchema, input);
    this.logger.info('Déconnexion utilisateur HotSpot demandée', { sessionId: data.sessionId });
    await this.client.delete(`/ip/hotspot/active/${encodeURIComponent(data.sessionId)}`);
  }

  // ==================== HotSpot : écriture ====================

  async createHotspotUser(input: CreateHotspotUserDto) {
    const data = validate(createHotspotUserSchema, input);

    const existing = await this.findHotspotUserByUsername(data.username);
    if (existing) {
      throw new MikrotikConflictError(`Le compte HotSpot "${data.username}" existe déjà`, {
        username: data.username,
      });
    }

    this.logger.info('Création compte HotSpot', { username: data.username, profile: data.profileName });
    const raw = await this.client.put<any>('/ip/hotspot/user', {
      name: data.username,
      password: data.password,
      profile: data.profileName,
      server: data.server,
      comment: data.comment,
    });
    return HotspotMapper.mapHotspotUser(raw);
  }

  async updateHotspotUser(input: UpdateHotspotUserDto) {
    const data = validate(updateHotspotUserSchema, input);
    const target = await this.requireHotspotUser(data.username);

    const payload: Record<string, unknown> = {};
    if (data.profileName !== undefined) payload.profile = data.profileName;
    if (data.password !== undefined) payload.password = data.password;
    if (data.comment !== undefined) payload.comment = data.comment;

    this.logger.info('Mise à jour compte HotSpot', { username: data.username });
    const raw = await this.client.patch<any>(`/ip/hotspot/user/${target.id}`, payload);
    return HotspotMapper.mapHotspotUser(raw);
  }

  async setHotspotUserDisabled(username: string, disabled: boolean) {
    const validUsername = validate(hotspotUsernameParamSchema, username);
    const target = await this.requireHotspotUser(validUsername);

    this.logger.info(disabled ? 'Suspension compte HotSpot' : 'Réactivation compte HotSpot', {
      username: validUsername,
    });
    const raw = await this.client.patch<any>(`/ip/hotspot/user/${target.id}`, {
      disabled: disabled ? 'true' : 'false',
    });
    return HotspotMapper.mapHotspotUser(raw);
  }

  async deleteHotspotUser(username: string) {
    const validUsername = validate(hotspotUsernameParamSchema, username);
    const target = await this.requireHotspotUser(validUsername);

    this.logger.info('Suppression compte HotSpot', { username: validUsername });
    await this.client.delete(`/ip/hotspot/user/${target.id}`);
  }

  /** Cookies de connexion : les purger coupe réellement un accès. */
  async getHotspotCookies() {
    const raw = await this.client.get<any[]>('/ip/hotspot/cookie');
    return raw.map(HotspotMapper.mapHotspotCookie);
  }

  async deleteHotspotCookie(id: string) {
    this.logger.info('Suppression cookie HotSpot', { id });
    await this.client.delete(`/ip/hotspot/cookie/${encodeURIComponent(id)}`);
  }

  async createHotspotProfile(input: CreateHotspotProfileDto) {
    const data = validate(createHotspotProfileSchema, input);

    const profiles = await this.getHotspotProfiles();
    if (profiles.some((profile) => profile.name === data.name)) {
      throw new MikrotikConflictError(`Le profil HotSpot "${data.name}" existe déjà`, {
        name: data.name,
      });
    }

    this.logger.info('Création profil HotSpot', { name: data.name });
    const raw = await this.client.put<any>('/ip/hotspot/user/profile', {
      name: data.name,
      'rate-limit': HotspotMapper.buildRateLimitToken(
        data.rateLimitRxBitsPerSecond,
        data.rateLimitTxBitsPerSecond,
      ),
      'shared-users': data.sharedUsers,
      'session-timeout': data.sessionTimeoutSeconds ? `${data.sessionTimeoutSeconds}s` : undefined,
    });
    return HotspotMapper.mapHotspotProfile(raw);
  }

  async updateHotspotProfile(input: UpdateHotspotProfileDto) {
    const data = validate(updateHotspotProfileSchema, input);
    const profiles = await this.getHotspotProfiles();
    const target = profiles.find((profile) => profile.name === data.name);
    if (!target) {
      throw new MikrotikNotFoundError('Profil HotSpot', data.name);
    }

    const payload: Record<string, unknown> = {};
    if (data.rateLimitRxBitsPerSecond !== undefined || data.rateLimitTxBitsPerSecond !== undefined) {
      payload['rate-limit'] = HotspotMapper.buildRateLimitToken(
        data.rateLimitRxBitsPerSecond,
        data.rateLimitTxBitsPerSecond,
      );
    }
    if (data.sharedUsers !== undefined) payload['shared-users'] = data.sharedUsers;
    if (data.sessionTimeoutSeconds !== undefined) {
      payload['session-timeout'] = `${data.sessionTimeoutSeconds}s`;
    }

    this.logger.info('Mise à jour profil HotSpot', { name: data.name });
    const raw = await this.client.patch<any>(`/ip/hotspot/user/profile/${target.id}`, payload);
    return HotspotMapper.mapHotspotProfile(raw);
  }

  // ==================== Contournement du portail captif ====================

  async getIpBindings() {
    const raw = await this.client.get<any[]>('/ip/hotspot/ip-binding');
    return raw.map(HotspotMapper.mapIpBinding);
  }

  async createIpBinding(input: CreateIpBindingDto) {
    const data = validate(createIpBindingSchema, input);

    const existing = await this.getIpBindings();
    const duplicate = existing.find(
      (binding) => binding.macAddress.toUpperCase() === data.macAddress.toUpperCase(),
    );
    if (duplicate) {
      throw new MikrotikConflictError(
        `Un contournement existe déjà pour la MAC ${data.macAddress}`,
        { macAddress: data.macAddress, bindingId: duplicate.id },
      );
    }

    this.logger.info('Création contournement HotSpot', {
      macAddress: data.macAddress,
      type: data.type,
    });
    const raw = await this.client.put<any>('/ip/hotspot/ip-binding', {
      'mac-address': data.macAddress,
      type: data.type,
      server: data.server,
      address: data.address,
      comment: data.comment,
    });
    return HotspotMapper.mapIpBinding(raw);
  }

  async setIpBindingType(id: string, type: IpBindingType) {
    const validType = validate(ipBindingTypeSchema, type);
    this.logger.info('Changement de type de contournement', { bindingId: id, type: validType });
    const raw = await this.client.patch<any>(`/ip/hotspot/ip-binding/${encodeURIComponent(id)}`, {
      type: validType,
    });
    return HotspotMapper.mapIpBinding(raw);
  }

  async deleteIpBinding(id: string) {
    this.logger.info('Suppression contournement HotSpot', { bindingId: id });
    await this.client.delete(`/ip/hotspot/ip-binding/${encodeURIComponent(id)}`);
  }

  async getDhcpLeases() {
    const raw = await this.client.get<any[]>('/ip/dhcp-server/lease');
    return raw.map(HotspotMapper.mapDhcpLease);
  }

  // ==================== User Manager : lecture ====================

  async getUserManagerUsers() {
    const raw = await this.client.get<any[]>('/user-manager/user');
    return raw.map(UmMapper.mapUserManagerUser);
  }

  async getUserManagerProfiles() {
    const raw = await this.client.get<any[]>('/user-manager/profile');
    return raw.map(UmMapper.mapUserManagerProfile);
  }

  /** Limitations de débit/quota — distinctes de la validité, qui vit sur le profil. */
  async getUserManagerLimitations() {
    const raw = await this.client.get<any[]>('/user-manager/limitation');
    return raw.map(UmMapper.mapUserManagerLimitation);
  }

  /** Jonctions profil ↔ limitation. */
  async getUserManagerProfileLimitations() {
    const raw = await this.client.get<any[]>('/user-manager/profile-limitation');
    return raw.map(UmMapper.mapUserManagerProfileLimitation);
  }

  async getUserManagerUserProfiles(username?: string) {
    const query = username ? { user: validate(usernameParamSchema, username) } : undefined;
    const raw = await this.client.get<any[]>('/user-manager/user-profile', query);
    return raw.map(UmMapper.mapUserManagerUserProfile);
  }

  async getUserManagerSessions(username?: string) {
    const query = username ? { user: validate(usernameParamSchema, username) } : undefined;
    const raw = await this.client.get<any[]>('/user-manager/session', query);
    return raw.map(UmMapper.mapUserManagerSession);
  }

  // ==================== User Manager : écriture ====================

  async createUserManagerUser(input: CreateUserManagerUserDto) {
    const data = validate(createUserManagerUserSchema, input);

    const existing = await this.findUserManagerUserByUsername(data.username);
    if (existing) {
      throw new MikrotikConflictError(`L'utilisateur "${data.username}" existe déjà`, {
        username: data.username,
      });
    }

    this.logger.info('Création utilisateur User Manager', { username: data.username });
    const raw = await this.client.put<any>('/user-manager/user', {
      name: data.username,
      password: data.password,
      'shared-users': data.sharedUsers ?? 1,
      comment: data.comment,
      group: data.group,
    });
    return UmMapper.mapUserManagerUser(raw);
  }

  /**
   * Création en lot : la liste des comptes n'est relue qu'une fois, et toutes
   * les entrées sont validées avant la moindre écriture. Un lot de tickets
   * part donc entier ou pas du tout, plutôt qu'à moitié.
   */
  async createUserManagerUsers(inputs: CreateUserManagerUserDto[]) {
    const data = inputs.map((input) => validate(createUserManagerUserSchema, input));

    const seen = new Set<string>();
    for (const item of data) {
      if (seen.has(item.username)) {
        throw new MikrotikConflictError(`Le nom "${item.username}" apparaît deux fois dans le lot`, {
          username: item.username,
        });
      }
      seen.add(item.username);
    }

    const existing = new Set((await this.getUserManagerUsers()).map((user) => user.username));
    const clash = data.find((item) => existing.has(item.username));
    if (clash) {
      throw new MikrotikConflictError(`L'utilisateur "${clash.username}" existe déjà`, {
        username: clash.username,
      });
    }

    this.logger.info('Création groupée User Manager', { count: data.length });
    const created: UserManagerUserDto[] = [];
    for (const item of data) {
      const raw = await this.client.put<any>('/user-manager/user', {
        name: item.username,
        password: item.password,
        'shared-users': item.sharedUsers ?? 1,
        comment: item.comment,
        group: item.group,
      });
      created.push(UmMapper.mapUserManagerUser(raw));
    }
    return created;
  }

  async deleteUserManagerUser(username: string) {
    const validUsername = validate(usernameParamSchema, username);
    const existing = await this.findUserManagerUserByUsername(validUsername);
    if (!existing) {
      throw new MikrotikNotFoundError('Utilisateur User Manager', validUsername);
    }
    this.logger.info('Suppression utilisateur User Manager', { username: validUsername });
    await this.client.delete(`/user-manager/user/${existing.id}`);
  }

  /**
   * Crée une offre User Manager. La validité calendaire et `starts-when`
   * vivent sur le profil lui-même : `/user-manager/profile-limitation` ne
   * sert qu'à rattacher une limitation de débit, et reste facultatif.
   */
  async createProfile(input: CreateProfileDto) {
    const data = validate(createProfileSchema, input);

    const existing = await this.getUserManagerProfiles();
    if (existing.some((profile) => profile.name === data.name)) {
      throw new MikrotikConflictError(`Le profil User Manager "${data.name}" existe déjà`, {
        name: data.name,
      });
    }

    this.logger.info('Création profil User Manager', { name: data.name });
    const raw = await this.client.put<any>('/user-manager/profile', {
      name: data.name,
      'name-for-users': data.nameForUsers ?? data.name,
      validity: UmMapper.formatValidity(data.validityDurationSeconds),
      'starts-when': data.startsWhen,
      price: data.price,
      'override-shared-users': data.sharedUsers ?? 'off',
      comment: data.comment,
    });

    return UmMapper.mapUserManagerProfile(raw);
  }

  async updateProfile(input: UpdateProfileDto) {
    const data = validate(updateProfileSchema, input);
    const profiles = await this.getUserManagerProfiles();
    const target = profiles.find((profile) => profile.name === data.name);
    if (!target) {
      throw new MikrotikNotFoundError('Profil User Manager', data.name);
    }

    this.logger.info('Mise à jour profil User Manager', { name: data.name });
    const payload: Record<string, unknown> = {};
    if (data.validityDurationSeconds !== undefined) {
      payload.validity = UmMapper.formatValidity(data.validityDurationSeconds);
    }
    if (data.startsWhen !== undefined) payload['starts-when'] = data.startsWhen;
    if (data.price !== undefined) payload.price = data.price;
    if (data.nameForUsers !== undefined) payload['name-for-users'] = data.nameForUsers;
    if (data.sharedUsers !== undefined) payload['override-shared-users'] = data.sharedUsers;
    if (data.comment !== undefined) payload.comment = data.comment;

    const raw = await this.client.patch<any>(`/user-manager/profile/${target.id}`, payload);
    return UmMapper.mapUserManagerProfile(raw);
  }

  /** Suspension / réactivation d'un abonné sans perdre son compte ni son historique. */
  async setUserManagerUserDisabled(username: string, disabled: boolean) {
    const validUsername = validate(usernameParamSchema, username);
    const existing = await this.findUserManagerUserByUsername(validUsername);
    if (!existing) {
      throw new MikrotikNotFoundError('Utilisateur User Manager', validUsername);
    }

    this.logger.info(disabled ? 'Suspension abonné User Manager' : 'Réactivation abonné User Manager', {
      username: validUsername,
    });
    const raw = await this.client.patch<any>(`/user-manager/user/${existing.id}`, {
      disabled: disabled ? 'true' : 'false',
    });
    return UmMapper.mapUserManagerUser(raw);
  }

  async assignProfile(input: AssignProfileDto) {
    const data = validate(assignProfileSchema, input);
    const user = await this.findUserManagerUserByUsername(data.username);
    if (!user) {
      throw new MikrotikNotFoundError('Utilisateur User Manager', data.username);
    }

    this.logger.info('Attribution de profil', { username: data.username, profile: data.profileName });
    const raw = await this.client.put<any>('/user-manager/user-profile', {
      user: data.username,
      profile: data.profileName,
    });
    return UmMapper.mapUserManagerUserProfile(raw);
  }

  async removeProfile(input: RemoveProfileAssignmentDto) {
    const data = validate(removeProfileAssignmentSchema, input);
    const assignments = await this.getUserManagerUserProfiles(data.username);
    const target = assignments.find((assignment) => assignment.profileName === data.profileName);
    if (!target) {
      throw new MikrotikNotFoundError(
        'Association utilisateur/profil',
        `${data.username}/${data.profileName}`,
      );
    }

    this.logger.info('Retrait de profil', { username: data.username, profile: data.profileName });
    await this.client.delete(`/user-manager/user-profile/${target.id}`);
  }

  /**
   * Rotation du mot de passe (ou des autres attributs) d'un compte existant.
   * Nécessaire dès qu'un client rachète : son compte est déjà là, et le
   * supprimer pour le recréer effacerait son historique de sessions.
   */
  async updateUserManagerUser(input: UpdateUserManagerUserDto) {
    const data = validate(updateUserManagerUserSchema, input);
    const existing = await this.findUserManagerUserByUsername(data.username);
    if (!existing) {
      throw new MikrotikNotFoundError('Utilisateur User Manager', data.username);
    }

    this.logger.info('Mise à jour utilisateur User Manager', { username: data.username });
    const payload: Record<string, unknown> = {};
    if (data.password !== undefined) payload.password = data.password;
    if (data.sharedUsers !== undefined) payload['shared-users'] = data.sharedUsers;
    if (data.comment !== undefined) payload.comment = data.comment;
    if (data.group !== undefined) payload.group = data.group;

    const raw = await this.client.patch<any>(`/user-manager/user/${existing.id}`, payload);
    return UmMapper.mapUserManagerUser(raw);
  }

  /**
   * RouterOS refuse de supprimer un profil encore attribué à un compte ou
   * encore rattaché à une limitation. L'erreur brute ne le dit pas
   * clairement : elle est traduite en conflit explicite.
   */
  async deleteProfile(name: string) {
    const validName = validate(profileNameParamSchema, name);
    const profiles = await this.getUserManagerProfiles();
    const target = profiles.find((profile) => profile.name === validName);
    if (!target) {
      throw new MikrotikNotFoundError('Profil User Manager', validName);
    }

    const assignments = await this.getUserManagerUserProfiles();
    const stillAssigned = assignments.filter((a) => a.profileName === validName);
    if (stillAssigned.length > 0) {
      throw new MikrotikConflictError(
        `Le profil "${validName}" est encore attribué à ${stillAssigned.length} compte(s)`,
        { name: validName, assignedTo: stillAssigned.map((a) => a.username) },
      );
    }

    this.logger.info('Suppression profil User Manager', { name: validName });
    await this.client.delete(`/user-manager/profile/${target.id}`);
  }

  // ============ User Manager : limitations de débit et de volume ============

  async createLimitation(input: CreateLimitationDto) {
    const data = validate(createLimitationSchema, input);

    const existing = await this.getUserManagerLimitations();
    if (existing.some((limitation) => limitation.name === data.name)) {
      throw new MikrotikConflictError(`La limitation "${data.name}" existe déjà`, {
        name: data.name,
      });
    }

    this.logger.info('Création limitation User Manager', { name: data.name });
    const raw = await this.client.put<any>('/user-manager/limitation', {
      name: data.name,
      ...buildLimitationPayload(data),
    });
    return UmMapper.mapUserManagerLimitation(raw);
  }

  async updateLimitation(input: UpdateLimitationDto) {
    const data = validate(updateLimitationSchema, input);
    const limitations = await this.getUserManagerLimitations();
    const target = limitations.find((limitation) => limitation.name === data.name);
    if (!target) {
      throw new MikrotikNotFoundError('Limitation User Manager', data.name);
    }

    this.logger.info('Mise à jour limitation User Manager', { name: data.name });
    const raw = await this.client.patch<any>(
      `/user-manager/limitation/${target.id}`,
      buildLimitationPayload(data),
    );
    return UmMapper.mapUserManagerLimitation(raw);
  }

  async deleteLimitation(name: string) {
    const validName = validate(limitationNameParamSchema, name);
    const limitations = await this.getUserManagerLimitations();
    const target = limitations.find((limitation) => limitation.name === validName);
    if (!target) {
      throw new MikrotikNotFoundError('Limitation User Manager', validName);
    }

    // Une limitation encore rattachée à un profil ne peut pas partir : la
    // jonction serait orpheline et RouterOS refuse.
    const junctions = await this.getUserManagerProfileLimitations();
    const attached = junctions.filter((junction) => junction.limitationName === validName);
    if (attached.length > 0) {
      throw new MikrotikConflictError(
        `La limitation "${validName}" est encore rattachée à ${attached.length} profil(s)`,
        { name: validName, profiles: attached.map((junction) => junction.profileName) },
      );
    }

    this.logger.info('Suppression limitation User Manager', { name: validName });
    await this.client.delete(`/user-manager/limitation/${target.id}`);
  }

  async attachLimitationToProfile(input: AttachLimitationDto) {
    const data = validate(attachLimitationSchema, input);

    const existing = await this.getUserManagerProfileLimitations();
    const already = existing.find(
      (junction) =>
        junction.profileName === data.profileName &&
        junction.limitationName === data.limitationName,
    );
    // Rattacher deux fois créerait un doublon côté RouterOS, qui l'accepte
    // sans broncher : l'opération est rendue idempotente ici.
    if (already) return already;

    this.logger.info('Rattachement limitation ↔ profil', {
      profile: data.profileName,
      limitation: data.limitationName,
    });
    const raw = await this.client.put<any>('/user-manager/profile-limitation', {
      profile: data.profileName,
      limitation: data.limitationName,
    });
    return UmMapper.mapUserManagerProfileLimitation(raw);
  }

  async detachLimitationFromProfile(input: AttachLimitationDto) {
    const data = validate(attachLimitationSchema, input);
    const junctions = await this.getUserManagerProfileLimitations();
    const targets = junctions.filter(
      (junction) =>
        junction.profileName === data.profileName &&
        junction.limitationName === data.limitationName,
    );
    if (targets.length === 0) {
      throw new MikrotikNotFoundError(
        'Rattachement profil/limitation',
        `${data.profileName}/${data.limitationName}`,
      );
    }

    this.logger.info('Retrait limitation ↔ profil', {
      profile: data.profileName,
      limitation: data.limitationName,
    });
    for (const target of targets) {
      await this.client.delete(`/user-manager/profile-limitation/${target.id}`);
    }
  }

  // ==================== Aides internes ====================

  private async findHotspotUserByUsername(username: string) {
    const users = await this.getHotspotUsers();
    return users.find((user) => user.username === username) ?? null;
  }

  /** Même chose, mais lève `MikrotikNotFoundError` si le compte n'existe pas. */
  private async requireHotspotUser(username: string) {
    const user = await this.findHotspotUserByUsername(username);
    if (!user) {
      throw new MikrotikNotFoundError('Compte HotSpot', username);
    }
    return user;
  }

  private async findUserManagerUserByUsername(username: string) {
    const users = await this.getUserManagerUsers();
    return users.find((user) => user.username === username) ?? null;
  }

}
