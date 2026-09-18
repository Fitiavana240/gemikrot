import { IMikrotikService } from './interfaces/mikrotik-service.interface';
import { RouterOSRestClient } from './client/routeros-rest-client';
import { ILogger } from './logging/logger.interface';
import * as RouterMapper from './mappers/router.mapper';
import * as HotspotMapper from './mappers/hotspot.mapper';
import * as UmMapper from './mappers/user-manager.mapper';
import { validate } from './validation/validate';
import {
  assignProfileSchema,
  createHotspotProfileSchema,
  createHotspotUserSchema,
  createIpBindingSchema,
  createProfileSchema,
  createUserManagerUserSchema,
  disconnectHotspotUserSchema,
  hotspotUsernameParamSchema,
  ipBindingTypeSchema,
  removeProfileAssignmentSchema,
  updateHotspotProfileSchema,
  updateHotspotUserSchema,
  updateProfileSchema,
  usernameParamSchema,
} from './validation/schemas';
import {
  AssignProfileDto,
  CreateHotspotProfileDto,
  CreateHotspotUserDto,
  CreateIpBindingDto,
  CreateProfileDto,
  CreateUserManagerUserDto,
  DisconnectHotspotUserDto,
  RemoveProfileAssignmentDto,
  UpdateHotspotProfileDto,
  UpdateHotspotUserDto,
  UpdateProfileDto,
} from './dto/commands.dto';
import { IpBindingType } from './dto/hotspot.dto';
import { MikrotikConflictError, MikrotikNotFoundError } from './errors/mikrotik.errors';

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

  async getUserManagerLimitations() {
    const raw = await this.client.get<any[]>('/user-manager/profile-limitation');
    return raw.map(UmMapper.mapUserManagerLimitation);
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

  async deleteUserManagerUser(username: string) {
    const validUsername = validate(usernameParamSchema, username);
    const existing = await this.findUserManagerUserByUsername(validUsername);
    if (!existing) {
      throw new MikrotikNotFoundError('Utilisateur User Manager', validUsername);
    }
    this.logger.info('Suppression utilisateur User Manager', { username: validUsername });
    await this.client.delete(`/user-manager/user/${existing.id}`);
  }

  async createProfile(input: CreateProfileDto) {
    const data = validate(createProfileSchema, input);
    this.logger.info('Création profil User Manager', { name: data.name });

    // Un profil User Manager complet nécessite deux entités RouterOS liées :
    // le `profile` (identité) et le `profile-limitation` (règles réelles).
    await this.client.put('/user-manager/profile', { name: data.name });

    const raw = await this.client.put<any>('/user-manager/profile-limitation', {
      name: data.name,
      validity: `${data.validityDurationSeconds}s`,
      'starts-when': data.startsWhen,
      'rate-limit': this.buildRateLimitToken(data.rateLimitRxBitsPerSecond, data.rateLimitTxBitsPerSecond),
      'transfer-limit': data.transferLimitBytes,
    });

    return UmMapper.mapUserManagerLimitation(raw);
  }

  async updateProfile(input: UpdateProfileDto) {
    const data = validate(updateProfileSchema, input);
    const limitations = await this.getUserManagerLimitations();
    const target = limitations.find((limitation) => limitation.name === data.name);
    if (!target) {
      throw new MikrotikNotFoundError('Profil User Manager', data.name);
    }

    this.logger.info('Mise à jour profil User Manager', { name: data.name });
    const payload: Record<string, unknown> = {};
    if (data.validityDurationSeconds !== undefined) payload.validity = `${data.validityDurationSeconds}s`;
    if (data.startsWhen !== undefined) payload['starts-when'] = data.startsWhen;
    if (data.rateLimitRxBitsPerSecond !== undefined || data.rateLimitTxBitsPerSecond !== undefined) {
      payload['rate-limit'] = this.buildRateLimitToken(
        data.rateLimitRxBitsPerSecond,
        data.rateLimitTxBitsPerSecond,
      );
    }
    if (data.transferLimitBytes !== undefined) payload['transfer-limit'] = data.transferLimitBytes;

    const raw = await this.client.patch<any>(`/user-manager/profile-limitation/${target.id}`, payload);
    return UmMapper.mapUserManagerLimitation(raw);
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

  private buildRateLimitToken(rx?: number, tx?: number): string | undefined {
    if (rx === undefined && tx === undefined) return undefined;
    const rxToken = UmMapper.formatRateToken(rx) ?? 'unlimited';
    const txToken = UmMapper.formatRateToken(tx) ?? 'unlimited';
    return `${rxToken}/${txToken}`;
  }
}
