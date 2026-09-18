import { IMikrotikService } from '../../src/interfaces/mikrotik-service.interface';
import {
  ClockDto,
  NetworkInterfaceDto,
  NtpStatusDto,
  RadiusStatusDto,
  RouterIdentityDto,
  SystemResourceDto,
} from '../../src/dto/router.dto';
import {
  DhcpLeaseDto,
  HotspotActiveUserDto,
  HotspotHostDto,
  HotspotProfileDto,
  HotspotUserDto,
  IpBindingDto,
  IpBindingType,
} from '../../src/dto/hotspot.dto';
import {
  UserManagerLimitationDto,
  UserManagerProfileDto,
  UserManagerProfileLimitationDto,
  UserManagerSessionDto,
  UserManagerUserDto,
  UserManagerUserProfileDto,
} from '../../src/dto/user-manager.dto';
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
} from '../../src/dto/commands.dto';
import { MikrotikConflictError, MikrotikNotFoundError } from '../../src/errors/mikrotik.errors';

/**
 * Implémentation 100% en mémoire de `IMikrotikService`, destinée aux tests
 * des couches SUPÉRIEURES du backend (services métier, contrôleurs) qui
 * dépendent de l'interface mais n'ont pas besoin — et ne doivent pas avoir
 * besoin — d'un vrai routeur ni même d'un mock HTTP.
 *
 * Ce n'est volontairement PAS un mock `jest.fn()` : c'est un vrai petit
 * modèle en mémoire, plus proche du comportement réel et donc plus utile
 * pour des tests d'intégration légers.
 */
export class MockMikrotikService implements IMikrotikService {
  private users = new Map<string, UserManagerUserDto>();
  private profiles = new Map<string, UserManagerProfileDto>();
  private limitations = new Map<string, UserManagerLimitationDto>();
  private profileLimitations: UserManagerProfileLimitationDto[] = [];
  private userProfiles: UserManagerUserProfileDto[] = [];
  private activeHotspotUsers: HotspotActiveUserDto[] = [];
  private hotspotUsers = new Map<string, HotspotUserDto>();
  private hotspotProfiles = new Map<string, HotspotProfileDto>();
  private ipBindings: IpBindingDto[] = [];
  private dhcpLeases: DhcpLeaseDto[] = [];
  private idCounter = 1;

  private nextId(): string {
    return `*${(this.idCounter++).toString(16)}`;
  }

  // ---------- Système (valeurs statiques plausibles) ----------

  async getRouterIdentity(): Promise<RouterIdentityDto> {
    return { name: 'wifitati-hap-ac2' };
  }

  async getSystemResource(): Promise<SystemResourceDto> {
    return {
      uptime: '1d02:03:04',
      version: '7.24.4',
      buildTime: '2025-01-01 00:00:00',
      cpuLoadPercent: 5,
      freeMemoryBytes: 100_000_000,
      totalMemoryBytes: 256_000_000,
      cpuCount: 4,
      cpuFrequencyMHz: 716,
      freeHddSpaceBytes: 16_000_000,
      totalHddSpaceBytes: 16_000_000,
      architectureName: 'arm',
      boardName: 'hAP ac2',
      platform: 'MikroTik',
    };
  }

  async getInterfaces(): Promise<NetworkInterfaceDto[]> {
    return [];
  }

  async getClock(): Promise<ClockDto> {
    return { time: '00:00:00', date: 'jan/01/2026', timeZone: 'UTC', gmtOffset: '+00:00' };
  }

  async getNtpStatus(): Promise<NtpStatusDto> {
    return { enabled: true, status: 'synchronized', servers: ['pool.ntp.org'], lastUpdate: null };
  }

  async getRadiusStatus(): Promise<RadiusStatusDto> {
    return { userManagerRunning: true, radiusIncomingEnabled: false, activeSessionsCount: 0, details: {} };
  }

  // ---------- HotSpot ----------

  async getHotspotActiveUsers(): Promise<HotspotActiveUserDto[]> {
    return [...this.activeHotspotUsers];
  }

  async getHotspotHosts(): Promise<HotspotHostDto[]> {
    return [];
  }

  async getHotspotUsers(): Promise<HotspotUserDto[]> {
    return [...this.hotspotUsers.values()];
  }

  async getHotspotProfiles(): Promise<HotspotProfileDto[]> {
    return [...this.hotspotProfiles.values()];
  }

  async disconnectHotspotUser(input: DisconnectHotspotUserDto): Promise<void> {
    this.activeHotspotUsers = this.activeHotspotUsers.filter((u) => u.id !== input.sessionId);
  }

  // ---------- HotSpot : écriture ----------

  async createHotspotUser(input: CreateHotspotUserDto): Promise<HotspotUserDto> {
    if (this.hotspotUsers.has(input.username)) {
      throw new MikrotikConflictError(`Le compte HotSpot "${input.username}" existe déjà`);
    }
    const user: HotspotUserDto = {
      id: this.nextId(),
      username: input.username,
      profile: input.profileName,
      disabled: false,
      comment: input.comment ?? null,
      server: input.server ?? null,
      bytesIn: 0,
      bytesOut: 0,
      limitUptimeSeconds: null,
      limitBytesIn: null,
      limitBytesOut: null,
    };
    this.hotspotUsers.set(input.username, user);
    return user;
  }

  async updateHotspotUser(input: UpdateHotspotUserDto): Promise<HotspotUserDto> {
    const existing = this.requireHotspotUser(input.username);
    const updated: HotspotUserDto = {
      ...existing,
      profile: input.profileName ?? existing.profile,
      comment: input.comment ?? existing.comment,
    };
    this.hotspotUsers.set(input.username, updated);
    return updated;
  }

  async setHotspotUserDisabled(username: string, disabled: boolean): Promise<HotspotUserDto> {
    const existing = this.requireHotspotUser(username);
    const updated: HotspotUserDto = { ...existing, disabled };
    this.hotspotUsers.set(username, updated);
    return updated;
  }

  async deleteHotspotUser(username: string): Promise<void> {
    this.requireHotspotUser(username);
    this.hotspotUsers.delete(username);
  }

  async createHotspotProfile(input: CreateHotspotProfileDto): Promise<HotspotProfileDto> {
    if (this.hotspotProfiles.has(input.name)) {
      throw new MikrotikConflictError(`Le profil HotSpot "${input.name}" existe déjà`);
    }
    const profile: HotspotProfileDto = {
      id: this.nextId(),
      name: input.name,
      rateLimitRxBitsPerSecond: input.rateLimitRxBitsPerSecond ?? null,
      rateLimitTxBitsPerSecond: input.rateLimitTxBitsPerSecond ?? null,
      sessionTimeoutSeconds: input.sessionTimeoutSeconds ?? null,
      sharedUsers: input.sharedUsers ?? 1,
      idleTimeoutSeconds: null,
    };
    this.hotspotProfiles.set(input.name, profile);
    return profile;
  }

  async updateHotspotProfile(input: UpdateHotspotProfileDto): Promise<HotspotProfileDto> {
    const existing = this.hotspotProfiles.get(input.name);
    if (!existing) {
      throw new MikrotikNotFoundError('Profil HotSpot', input.name);
    }
    const updated: HotspotProfileDto = {
      ...existing,
      rateLimitRxBitsPerSecond: input.rateLimitRxBitsPerSecond ?? existing.rateLimitRxBitsPerSecond,
      rateLimitTxBitsPerSecond: input.rateLimitTxBitsPerSecond ?? existing.rateLimitTxBitsPerSecond,
      sessionTimeoutSeconds: input.sessionTimeoutSeconds ?? existing.sessionTimeoutSeconds,
      sharedUsers: input.sharedUsers ?? existing.sharedUsers,
    };
    this.hotspotProfiles.set(input.name, updated);
    return updated;
  }

  // ---------- Contournement du portail captif ----------

  async getIpBindings(): Promise<IpBindingDto[]> {
    return [...this.ipBindings];
  }

  async createIpBinding(input: CreateIpBindingDto): Promise<IpBindingDto> {
    const duplicate = this.ipBindings.find(
      (binding) => binding.macAddress.toUpperCase() === input.macAddress.toUpperCase(),
    );
    if (duplicate) {
      throw new MikrotikConflictError(`Un contournement existe déjà pour la MAC ${input.macAddress}`);
    }
    const binding: IpBindingDto = {
      id: this.nextId(),
      macAddress: input.macAddress,
      address: input.address ?? null,
      toAddress: null,
      type: input.type,
      server: input.server ?? null,
      comment: input.comment ?? null,
      disabled: false,
    };
    this.ipBindings.push(binding);
    return binding;
  }

  async setIpBindingType(id: string, type: IpBindingType): Promise<IpBindingDto> {
    const binding = this.ipBindings.find((b) => b.id === id);
    if (!binding) {
      throw new MikrotikNotFoundError('Contournement HotSpot', id);
    }
    binding.type = type;
    return binding;
  }

  async deleteIpBinding(id: string): Promise<void> {
    const before = this.ipBindings.length;
    this.ipBindings = this.ipBindings.filter((b) => b.id !== id);
    if (this.ipBindings.length === before) {
      throw new MikrotikNotFoundError('Contournement HotSpot', id);
    }
  }

  async getDhcpLeases(): Promise<DhcpLeaseDto[]> {
    return [...this.dhcpLeases];
  }

  private requireHotspotUser(username: string): HotspotUserDto {
    const user = this.hotspotUsers.get(username);
    if (!user) {
      throw new MikrotikNotFoundError('Compte HotSpot', username);
    }
    return user;
  }

  // ---------- User Manager : lecture ----------

  async getUserManagerUsers(): Promise<UserManagerUserDto[]> {
    return [...this.users.values()];
  }

  async getUserManagerProfiles(): Promise<UserManagerProfileDto[]> {
    return [...this.profiles.values()];
  }

  async getUserManagerLimitations(): Promise<UserManagerLimitationDto[]> {
    return [...this.limitations.values()];
  }

  async getUserManagerProfileLimitations(): Promise<UserManagerProfileLimitationDto[]> {
    return [...this.profileLimitations];
  }

  async getUserManagerUserProfiles(username?: string): Promise<UserManagerUserProfileDto[]> {
    return username ? this.userProfiles.filter((p) => p.username === username) : [...this.userProfiles];
  }

  async getUserManagerSessions(_username?: string): Promise<UserManagerSessionDto[]> {
    return [];
  }

  // ---------- User Manager : écriture ----------

  async createUserManagerUser(input: CreateUserManagerUserDto): Promise<UserManagerUserDto> {
    if (this.users.has(input.username)) {
      throw new MikrotikConflictError(`L'utilisateur "${input.username}" existe déjà`);
    }
    const user: UserManagerUserDto = {
      id: this.nextId(),
      username: input.username,
      disabled: false,
      sharedUsers: input.sharedUsers ?? 1,
      comment: input.comment ?? null,
      group: input.group ?? null,
    };
    this.users.set(input.username, user);
    return user;
  }

  async deleteUserManagerUser(username: string): Promise<void> {
    if (!this.users.has(username)) {
      throw new MikrotikNotFoundError('Utilisateur User Manager', username);
    }
    this.users.delete(username);
    this.userProfiles = this.userProfiles.filter((p) => p.username !== username);
  }

  async setUserManagerUserDisabled(username: string, disabled: boolean): Promise<UserManagerUserDto> {
    const user = this.users.get(username);
    if (!user) {
      throw new MikrotikNotFoundError('Utilisateur User Manager', username);
    }
    const updated: UserManagerUserDto = { ...user, disabled };
    this.users.set(username, updated);
    return updated;
  }

  async createProfile(input: CreateProfileDto): Promise<UserManagerProfileDto> {
    if (this.profiles.has(input.name)) {
      throw new MikrotikConflictError(`Le profil User Manager "${input.name}" existe déjà`);
    }
    const profile: UserManagerProfileDto = {
      id: this.nextId(),
      name: input.name,
      nameForUsers: input.nameForUsers ?? input.name,
      comment: input.comment ?? null,
      validityDurationSeconds: input.validityDurationSeconds,
      startsWhen: input.startsWhen,
      price: input.price ?? 0,
      overrideSharedUsers: input.sharedUsers ?? null,
    };
    this.profiles.set(input.name, profile);
    return profile;
  }

  async updateProfile(input: UpdateProfileDto): Promise<UserManagerProfileDto> {
    const existing = this.profiles.get(input.name);
    if (!existing) {
      throw new MikrotikNotFoundError('Profil User Manager', input.name);
    }
    const updated: UserManagerProfileDto = {
      ...existing,
      validityDurationSeconds:
        input.validityDurationSeconds !== undefined
          ? input.validityDurationSeconds
          : existing.validityDurationSeconds,
      startsWhen: input.startsWhen ?? existing.startsWhen,
      price: input.price ?? existing.price,
      nameForUsers: input.nameForUsers ?? existing.nameForUsers,
      overrideSharedUsers: input.sharedUsers ?? existing.overrideSharedUsers,
      comment: input.comment ?? existing.comment,
    };
    this.profiles.set(input.name, updated);
    return updated;
  }

  async assignProfile(input: AssignProfileDto): Promise<UserManagerUserProfileDto> {
    if (!this.users.has(input.username)) {
      throw new MikrotikNotFoundError('Utilisateur User Manager', input.username);
    }
    const profile = this.profiles.get(input.profileName);
    // Reproduit le calcul du routeur : `end-time` dérive de la validité.
    const endTime =
      profile?.validityDurationSeconds != null
        ? new Date(Date.now() + profile.validityDurationSeconds * 1000).toISOString()
        : null;

    const assignment: UserManagerUserProfileDto = {
      id: this.nextId(),
      username: input.username,
      profileName: input.profileName,
      endTime,
      state: 'running-active',
    };
    this.userProfiles.push(assignment);
    return assignment;
  }

  async removeProfile(input: RemoveProfileAssignmentDto): Promise<void> {
    const before = this.userProfiles.length;
    this.userProfiles = this.userProfiles.filter(
      (p) => !(p.username === input.username && p.profileName === input.profileName),
    );
    if (this.userProfiles.length === before) {
      throw new MikrotikNotFoundError('Association utilisateur/profil', `${input.username}/${input.profileName}`);
    }
  }

  async updateUserManagerUser(input: UpdateUserManagerUserDto): Promise<UserManagerUserDto> {
    const user = this.users.get(input.username);
    if (!user) {
      throw new MikrotikNotFoundError('Utilisateur User Manager', input.username);
    }
    const updated: UserManagerUserDto = {
      ...user,
      sharedUsers: input.sharedUsers ?? user.sharedUsers,
      comment: input.comment ?? user.comment,
      group: input.group ?? user.group,
    };
    this.users.set(input.username, updated);
    return updated;
  }

  async deleteProfile(name: string): Promise<void> {
    if (!this.profiles.has(name)) {
      throw new MikrotikNotFoundError('Profil User Manager', name);
    }
    const assigned = this.userProfiles.filter((p) => p.profileName === name);
    if (assigned.length > 0) {
      throw new MikrotikConflictError(
        `Le profil "${name}" est encore attribué à ${assigned.length} compte(s)`,
      );
    }
    this.profiles.delete(name);
  }

  // ---------- User Manager : limitations ----------

  async createLimitation(input: CreateLimitationDto): Promise<UserManagerLimitationDto> {
    if (this.limitations.has(input.name)) {
      throw new MikrotikConflictError(`La limitation "${input.name}" existe déjà`);
    }
    const limitation: UserManagerLimitationDto = {
      id: this.nextId(),
      name: input.name,
      rateLimit: {
        rxBitsPerSecond: input.rateLimitRxBitsPerSecond ?? null,
        txBitsPerSecond: input.rateLimitTxBitsPerSecond ?? null,
      },
      transferLimitBytes: input.transferLimitBytes ?? null,
      uptimeLimitSeconds: input.uptimeLimitSeconds ?? null,
    };
    this.limitations.set(input.name, limitation);
    return limitation;
  }

  async updateLimitation(input: UpdateLimitationDto): Promise<UserManagerLimitationDto> {
    const existing = this.limitations.get(input.name);
    if (!existing) {
      throw new MikrotikNotFoundError('Limitation User Manager', input.name);
    }
    const updated: UserManagerLimitationDto = {
      ...existing,
      rateLimit: {
        rxBitsPerSecond:
          input.rateLimitRxBitsPerSecond !== undefined
            ? input.rateLimitRxBitsPerSecond
            : existing.rateLimit.rxBitsPerSecond,
        txBitsPerSecond:
          input.rateLimitTxBitsPerSecond !== undefined
            ? input.rateLimitTxBitsPerSecond
            : existing.rateLimit.txBitsPerSecond,
      },
      transferLimitBytes:
        input.transferLimitBytes !== undefined
          ? input.transferLimitBytes
          : existing.transferLimitBytes,
      uptimeLimitSeconds:
        input.uptimeLimitSeconds !== undefined
          ? input.uptimeLimitSeconds
          : existing.uptimeLimitSeconds,
    };
    this.limitations.set(input.name, updated);
    return updated;
  }

  async deleteLimitation(name: string): Promise<void> {
    if (!this.limitations.has(name)) {
      throw new MikrotikNotFoundError('Limitation User Manager', name);
    }
    const attached = this.profileLimitations.filter((j) => j.limitationName === name);
    if (attached.length > 0) {
      throw new MikrotikConflictError(
        `La limitation "${name}" est encore rattachée à ${attached.length} profil(s)`,
      );
    }
    this.limitations.delete(name);
  }

  async attachLimitationToProfile(input: AttachLimitationDto): Promise<UserManagerProfileLimitationDto> {
    const already = this.profileLimitations.find(
      (j) => j.profileName === input.profileName && j.limitationName === input.limitationName,
    );
    if (already) return already;

    const junction: UserManagerProfileLimitationDto = {
      id: this.nextId(),
      profileName: input.profileName,
      limitationName: input.limitationName,
    };
    this.profileLimitations.push(junction);
    return junction;
  }

  async detachLimitationFromProfile(input: AttachLimitationDto): Promise<void> {
    const before = this.profileLimitations.length;
    this.profileLimitations = this.profileLimitations.filter(
      (j) => !(j.profileName === input.profileName && j.limitationName === input.limitationName),
    );
    if (this.profileLimitations.length === before) {
      throw new MikrotikNotFoundError(
        'Rattachement profil/limitation',
        `${input.profileName}/${input.limitationName}`,
      );
    }
  }

  // ---------- Aides de test ----------

  /** Permet à un test de préparer un état (ex : simuler une session active). */
  seedActiveHotspotUser(user: HotspotActiveUserDto): void {
    this.activeHotspotUsers.push(user);
  }

  seedDhcpLease(lease: DhcpLeaseDto): void {
    this.dhcpLeases.push(lease);
  }
}
