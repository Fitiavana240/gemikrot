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
  HotspotCookieDto,
  HotspotHostDto,
  HotspotProfileDto,
  HotspotServerDto,
  HotspotServerProfileDto,
  HotspotUserDto,
  IpBindingDto,
  IpBindingType,
  WalledGardenEntryDto,
  WalledGardenIpEntryDto,
} from '../../src/dto/hotspot.dto';
import {
  UserManagerLimitationDto,
  UserManagerProfileDto,
  UserManagerProfileLimitationDto,
  UserManagerSessionDto,
  UserManagerUserDto,
  UserManagerPaymentDto,
  UserManagerUserProfileDto,
} from '../../src/dto/user-manager.dto';
import {
  AssignProfileDto,
  AttachLimitationDto,
  CreateHotspotProfileDto,
  CreateHotspotUserDto,
  CreateIpBindingDto,
  CreateSimpleQueueDto,
  UpdateSimpleQueueDto,
  CreateLimitationDto,
  CreateProfileDto,
  CreateUserManagerUserDto,
  CreateWalledGardenEntryDto,
  CreateWalledGardenIpEntryDto,
  DisconnectHotspotUserDto,
  RemoveProfileAssignmentDto,
  UpdateHotspotProfileDto,
  UpdateHotspotUserDto,
  UpdateLimitationDto,
  UpdateProfileDto,
  UpdateUserManagerUserDto,
} from '../../src/dto/commands.dto';
import {
  IpPoolDto,
  PppActiveDto,
  PppProfileDto,
  PppSecretDto,
  PppoeServerDto,
} from '../../src/dto/ppp.dto';
import { CreatePppSecretDto, UpdatePppSecretDto } from '../../src/dto/commands.dto';
import {
  HotspotServicePortDto,
  UmAttributeDto,
  UmRouterDto,
  UmUserGroupDto,
} from '../../src/dto/router-config.dto';
import {
  RouterFileDto,
  RouterStorageDto,
  UserManagerReadinessDto,
} from '../../src/dto/router-storage.dto';
import {
  AddressPoolDto,
  ArpEntryDto,
  BridgeDto,
  BridgePortDto,
  CertificateDto,
  ChangementRouteurDto,
  DhcpClientDto,
  DnsSettingsDto,
  DnsStaticEntryDto,
  FirewallRuleDto,
  RouteDto,
  DhcpServerDto,
  IpCloudDto,
  IpServiceDto,
  EthernetPortDto,
  HorlogeRouteurDto,
  IpAddressDto,
  NetworkInterfaceStatsDto,
  RadiusClientDto,
  RouterAccountDto,
  RouterAccountGroupDto,
  RouterExpositionDto,
  RouterLogEntryDto,
  RouterScheduleDto,
  RouterScriptDto,
  SimpleQueueDto,
  SuiviConnexionsDto,
  WireguardInterfaceDto,
  WireguardPeerDto,
  WirelessClientDto,
  WirelessInterfaceDto,
} from '../../src/dto/router-tools.dto';
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
  private cookies: HotspotCookieDto[] = [];
  private walledGarden: WalledGardenEntryDto[] = [];
  private walledGardenIps: WalledGardenIpEntryDto[] = [];
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

  private hotspotHosts: HotspotHostDto[] = [];

  async getHotspotHosts(): Promise<HotspotHostDto[]> {
    return [...this.hotspotHosts];
  }

  async removeHotspotHost(id: string): Promise<void> {
    this.hotspotHosts = this.hotspotHosts.filter((h) => h.id !== id);
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
      macAddress: input.macAddress ?? null,
      disabled: false,
      comment: input.comment ?? null,
      server: input.server ?? null,
      bytesIn: 0,
      bytesOut: 0,
      uptimeSeconds: 0,
      limitUptimeSeconds: null,
      limitBytesTotal: null,
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
      keepaliveTimeoutSeconds: null,
      // Le cookie est ce qui rouvre une session sans repasser par le
      // portail : un profil créé sans lui n'en pose pas.
      addMacCookie: false,
      macCookieTimeoutSeconds: null,
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

  /** Vide, comme sur le parc : personne n'encaisse par le routeur. */
  async getUserManagerPayments(): Promise<UserManagerPaymentDto[]> {
    return [];
  }

  // ---------- User Manager : écriture ----------

  async getHotspotServers(): Promise<HotspotServerDto[]> {
    return [
      {
        id: '*1',
        name: 'hotspot-tati',
        interfaceName: 'HOTSPOT',
        addressPool: 'pool-hotspot',
        profileName: 'hsprof-tati',
        idleTimeoutSeconds: 900,
        addressesPerMac: 1,
        disabled: false,
      },
    ];
  }

  async getHotspotServerProfiles(): Promise<HotspotServerProfileDto[]> {
    return [
      {
        id: '*1',
        name: 'hsprof-tati',
        dnsName: 'wifitati.net',
        hotspotAddress: '192.168.88.1',
        htmlDirectory: 'flash/hotspot',
        loginBy: ['mac', 'cookie', 'http-chap', 'https', 'http-pap', 'mac-cookie'],
        httpCookieLifetimeSeconds: 259_200,
        useRadius: true,
        radiusAccounting: true,
      },
    ];
  }

  async getWalledGarden(): Promise<WalledGardenEntryDto[]> {
    return [...this.walledGarden];
  }

  async createWalledGardenEntry(input: CreateWalledGardenEntryDto): Promise<WalledGardenEntryDto> {
    const entry: WalledGardenEntryDto = {
      id: this.nextId(),
      action: input.action ?? 'allow',
      dstHost: input.dstHost,
      dstPort: input.dstPort ?? null,
      path: null,
      comment: input.comment ?? null,
      disabled: false,
      hits: 0,
    };
    this.walledGarden.push(entry);
    return entry;
  }

  async deleteWalledGardenEntry(id: string): Promise<void> {
    const before = this.walledGarden.length;
    this.walledGarden = this.walledGarden.filter((entry) => entry.id !== id);
    if (this.walledGarden.length === before) {
      throw new MikrotikNotFoundError('Entrée Walled Garden', id);
    }
  }

  async getWalledGardenIps(): Promise<WalledGardenIpEntryDto[]> {
    return [...this.walledGardenIps];
  }

  async createWalledGardenIpEntry(
    input: CreateWalledGardenIpEntryDto,
  ): Promise<WalledGardenIpEntryDto> {
    const entry: WalledGardenIpEntryDto = {
      id: this.nextId(),
      action: input.action ?? 'accept',
      dstAddress: input.dstAddress,
      dstPort: input.dstPort ?? null,
      protocol: input.protocol ?? null,
      comment: input.comment ?? null,
      disabled: false,
    };
    this.walledGardenIps.push(entry);
    return entry;
  }

  async deleteWalledGardenIpEntry(id: string): Promise<void> {
    const before = this.walledGardenIps.length;
    this.walledGardenIps = this.walledGardenIps.filter((entry) => entry.id !== id);
    if (this.walledGardenIps.length === before) {
      throw new MikrotikNotFoundError('Entrée Walled Garden IP', id);
    }
  }

  async getHotspotCookies(): Promise<HotspotCookieDto[]> {
    return [...this.cookies];
  }

  async deleteHotspotCookie(id: string): Promise<void> {
    const before = this.cookies.length;
    this.cookies = this.cookies.filter((cookie) => cookie.id !== id);
    if (this.cookies.length === before) {
      throw new MikrotikNotFoundError('Cookie HotSpot', id);
    }
  }

  /** Permet à un test de simuler un cookie encore valide. */
  seedHotspotCookie(cookie: HotspotCookieDto): void {
    this.cookies.push(cookie);
  }

  async createUserManagerUsers(inputs: CreateUserManagerUserDto[]): Promise<UserManagerUserDto[]> {
    const created: UserManagerUserDto[] = [];
    for (const input of inputs) {
      created.push(await this.createUserManagerUser(input));
    }
    return created;
  }

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

  async pruneOrphanAssignments(): Promise<number> {
    const before = this.userProfiles.length;
    this.userProfiles = this.userProfiles.filter((p) => this.users.has(p.username));
    return before - this.userProfiles.length;
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
      // Une attribution créée ici porte forcément un compte existant : le
      // cas contraire vient d'attributions orphelines lues sur le routeur.
      usernameIntrouvable: false,
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
      downloadLimitBytes: input.downloadLimitBytes ?? null,
      uploadLimitBytes: input.uploadLimitBytes ?? null,
      uptimeLimitSeconds: input.uptimeLimitSeconds ?? null,
      resetCountersIntervalSeconds: input.resetCountersIntervalSeconds ?? null,
      resetCountersStartTime: input.resetCountersStartTime ?? null,
      // Le garanti, par opposition au plafond : RouterOS le sert d'abord à
      // tout le monde, puis distribue ce qui reste.
      rateLimitMin: {
        rxBitsPerSecond: input.rateLimitMinRxBitsPerSecond ?? null,
        txBitsPerSecond: input.rateLimitMinTxBitsPerSecond ?? null,
      },
      rateLimitPriority: input.rateLimitPriority ?? null,
      // Les trois réglages de pointe ne veulent rien dire séparément :
      // `burst` sans `burstTime` ne s'applique jamais. Une limitation créée
      // sans eux n'en porte aucun.
      rateLimitBurst: {
        rxBitsPerSecond: input.rateLimitBurstRxBitsPerSecond ?? null,
        txBitsPerSecond: input.rateLimitBurstTxBitsPerSecond ?? null,
      },
      rateLimitBurstThreshold: {
        rxBitsPerSecond: input.rateLimitBurstThresholdRxBitsPerSecond ?? null,
        txBitsPerSecond: input.rateLimitBurstThresholdTxBitsPerSecond ?? null,
      },
      rateLimitBurstTimeSeconds: {
        rx: input.rateLimitBurstTimeRxSeconds ?? null,
        tx: input.rateLimitBurstTimeTxSeconds ?? null,
      },
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
      // Une jonction créée sans condition vaut toute la journée, tous les
      // jours — c'est aussi ce que RouterOS écrit par défaut.
      fromTimeSeconds: 0,
      tillTimeSeconds: 86_399,
      weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
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


  // ---------- PPPoE ----------
  //
  // Le parc de démonstration ne vend pas de PPPoE : ces collections sont
  // vides, et un test qui en a besoin les alimente par `seedPppSecret`.

  pppSecrets: PppSecretDto[] = [];
  pppProfiles: PppProfileDto[] = [];
  pppActive: PppActiveDto[] = [];

  async getPppSecrets(): Promise<PppSecretDto[]> {
    return [...this.pppSecrets];
  }

  async getPppProfiles(): Promise<PppProfileDto[]> {
    return [...this.pppProfiles];
  }

  async getPppActive(): Promise<PppActiveDto[]> {
    return [...this.pppActive];
  }

  async getPppoeServers(): Promise<PppoeServerDto[]> {
    return [];
  }

  async getIpPools(): Promise<IpPoolDto[]> {
    return [];
  }

  async createPppSecret(input: CreatePppSecretDto): Promise<PppSecretDto> {
    if (this.pppSecrets.some((s) => s.username === input.username)) {
      throw new MikrotikConflictError(`Le compte PPPoE "${input.username}" existe déjà`, {
        username: input.username,
      });
    }
    const secret: PppSecretDto = {
      id: `*${this.pppSecrets.length + 1}`,
      username: input.username,
      disabled: false,
      profile: input.profile ?? null,
      service: input.service ?? 'pppoe',
      comment: input.comment ?? null,
      remoteAddress: input.remoteAddress ?? null,
      limitBytesIn: null,
      limitBytesOut: null,
      lastLoggedOut: null,
    };
    this.pppSecrets.push(secret);
    return secret;
  }

  async updatePppSecret(username: string, input: UpdatePppSecretDto): Promise<PppSecretDto> {
    const secret = this.pppSecrets.find((s) => s.username === username);
    if (!secret) throw new MikrotikNotFoundError('Compte PPPoE', username);
    // Seuls les champs fournis, comme le vrai : un simulacre qui ecraserait
    // tout laisserait passer un bogue que la production paierait.
    if (input.profile !== undefined) secret.profile = input.profile;
    if (input.service !== undefined) secret.service = input.service;
    if (input.remoteAddress !== undefined) secret.remoteAddress = input.remoteAddress;
    if (input.comment !== undefined) secret.comment = input.comment;
    return secret;
  }

  async setPppSecretDisabled(username: string, disabled: boolean): Promise<PppSecretDto> {
    const secret = this.pppSecrets.find((s) => s.username === username);
    if (!secret) throw new MikrotikNotFoundError('Compte PPPoE', username);
    secret.disabled = disabled;
    return secret;
  }

  async deletePppSecret(username: string): Promise<void> {
    const before = this.pppSecrets.length;
    this.pppSecrets = this.pppSecrets.filter((s) => s.username !== username);
    if (this.pppSecrets.length === before) {
      throw new MikrotikNotFoundError('Compte PPPoE', username);
    }
  }

  async disconnectPppActive(id: string): Promise<void> {
    this.pppActive = this.pppActive.filter((s) => s.id !== id);
  }

  // ---------- Tables de configuration ----------
  //
  // Vides par defaut : aucun test existant n'en depend, et un simulacre qui
  // invente des lignes ferait passer pour verifie ce qui ne l'est pas.

  async getUmRouters(): Promise<UmRouterDto[]> {
    return [];
  }

  async getUmUserGroups(): Promise<UmUserGroupDto[]> {
    return [];
  }

  async getUmAttributes(): Promise<UmAttributeDto[]> {
    return [];
  }

  async getHotspotServicePorts(): Promise<HotspotServicePortDto[]> {
    return [];
  }

  // ---------- Diagnostic et debit ----------
  //
  // Vides : aucun test existant n'en depend, et un simulacre qui invente des
  // lignes ferait passer pour verifie ce qui ne l'est pas.

  private queues: SimpleQueueDto[] = [];

  async getSimpleQueues(): Promise<SimpleQueueDto[]> {
    return this.queues;
  }

  async createSimpleQueue(input: CreateSimpleQueueDto): Promise<SimpleQueueDto> {
    const paire = (montant: number, descendant: number) => ({ montant, descendant });
    const queue: SimpleQueueDto = {
      id: `*${this.queues.length + 1}`,
      name: input.name,
      target: input.target,
      maxLimit: paire(input.maxLimitUpload, input.maxLimitDownload),
      limitAt: paire(0, 0),
      rate: paire(0, 0),
      bytes: paire(0, 0),
      dropped: paire(0, 0),
      dynamic: false,
      disabled: input.disabled ?? false,
      comment: input.comment ?? null,
    };
    this.queues.push(queue);
    return queue;
  }

  async updateSimpleQueue(id: string, input: UpdateSimpleQueueDto): Promise<SimpleQueueDto> {
    const queue = this.queues.find((q) => q.id === id);
    if (!queue) throw new Error(`File ${id} introuvable`);
    if (input.name !== undefined) queue.name = input.name;
    if (input.target !== undefined) queue.target = input.target;
    if (input.maxLimitUpload !== undefined && input.maxLimitDownload !== undefined) {
      queue.maxLimit = {
        montant: input.maxLimitUpload,
        descendant: input.maxLimitDownload,
      };
    }
    if (input.comment !== undefined) queue.comment = input.comment;
    if (input.disabled !== undefined) queue.disabled = input.disabled;
    return queue;
  }

  async deleteSimpleQueue(id: string): Promise<void> {
    this.queues = this.queues.filter((q) => q.id !== id);
  }

  async getRouterLog(): Promise<RouterLogEntryDto[]> {
    return [];
  }

  async getInterfaceStats(): Promise<NetworkInterfaceStatsDto[]> {
    return [];
  }

  async getIpServices(): Promise<IpServiceDto[]> {
    return [];
  }

  async getIpCloud(): Promise<IpCloudDto> {
    return {
      ddnsEnabled: 'no',
      dnsName: null,
      publicAddress: null,
      updateTime: false,
      backToHomeVpn: null,
    };
  }

  async getArpEntries(): Promise<ArpEntryDto[]> {
    return [];
  }

  async getDhcpServers(): Promise<DhcpServerDto[]> {
    return [];
  }

  async getFirewallFilterRules(): Promise<FirewallRuleDto[]> {
    return [];
  }

  async getFirewallNatRules(): Promise<FirewallRuleDto[]> {
    return [];
  }

  async getDnsSettings(): Promise<DnsSettingsDto> {
    return {
      servers: [],
      dynamicServers: [],
      allowRemoteRequests: false,
      cacheSize: null,
      cacheUsed: null,
      maxConcurrentQueries: null,
      useDohServer: null,
      verifyDohCert: false,
    };
  }

  async getDnsStaticEntries(): Promise<DnsStaticEntryDto[]> {
    return [];
  }

  async getRoutes(): Promise<RouteDto[]> {
    return [];
  }

  async getRouterFiles(): Promise<RouterFileDto[]> {
    return [];
  }

  async getRouterStorage(): Promise<RouterStorageDto> {
    return {
      boardName: null,
      version: null,
      architecture: null,
      internalTotalBytes: 0,
      internalFreeBytes: 0,
      memoryTotalBytes: 0,
      memoryFreeBytes: 0,
      disks: [],
      packages: [],
      parRacine: [],
      routerboard: null,
      miseAJour: null,
    };
  }

  /**
   * Etat de User Manager, volontairement mutable.
   *
   * Le service de reparation ne croit pas l'absence d'erreur : il relit
   * l'etat apres avoir ecrit. Eprouver cela suppose un simulacre qui puisse
   * changer — et qui puisse aussi *refuser* de changer, ce que fait un vrai
   * routeur quand la forme de la requete ne lui convient pas.
   */
  umEtat = {
    serviceEnabled: false,
    useProfiles: false,
    /** `enable`, `disable`, ou rien — comme le `scheduled` de RouterOS. */
    paquetProgramme: '' as '' | 'enable' | 'disable',
  };
  /** Quand c'est vrai, les ecritures sont acceptees puis ignorees. */
  umIgnoreLesEcritures = false;

  async getUserManagerReadiness(): Promise<UserManagerReadinessDto> {
    return {
      packageInstalled: true,
      packageAvailable: false,
      packageEnabled: false,
      packageVersion: '7.24.4',
      packageSizeBytes: 344209,
      packageScheduled: this.umEtat.paquetProgramme || null,
      serviceEnabled: this.umEtat.serviceEnabled,
      useProfiles: this.umEtat.useProfiles,
      database: null,
      internalFreeBytes: 286720,
      internalTotalBytes: 16777216,
      disks: [],
      constats: [
        ...(this.umEtat.serviceEnabled
          ? []
          : [
              {
                code: 'service-eteint',
                niveau: 'bloquant' as const,
                titre: 'Le service User Manager est eteint',
                detail: '',
                commande: '/user-manager/set enabled=yes',
                reparation: 'allumer-service',
              },
            ]),
        ...(this.umEtat.useProfiles
          ? []
          : [
              {
                code: 'profils-desactives',
                niveau: 'avertissement' as const,
                titre: 'Les profils sont desactives',
                detail: '',
                commande: '/user-manager/set use-profiles=yes',
                reparation: 'activer-profils',
              },
            ]),
        ...(this.umEtat.paquetProgramme === 'enable'
          ? []
          : this.umEtat.paquetProgramme === 'disable'
            ? [
                {
                  code: 'paquet-desactivation-programmee',
                  niveau: 'bloquant' as const,
                  titre: 'Desactivation programmee au prochain demarrage',
                  detail: '',
                  commande: '/system/package/unschedule user-manager',
                  reparation: 'annuler-desactivation',
                },
              ]
            : [
                {
                  code: 'paquet-desactive',
                  niveau: 'bloquant' as const,
                  titre: 'Le paquet est installe mais desactive',
                  detail: '',
                  commande: '/system/package/enable user-manager',
                  reparation: 'activer-paquet',
                },
              ]),
      ],
    };
  }

  async setUserManagerSettings(payload: { enabled?: boolean; useProfiles?: boolean }) {
    if (this.umIgnoreLesEcritures) return;
    if (payload.enabled !== undefined) this.umEtat.serviceEnabled = payload.enabled;
    if (payload.useProfiles !== undefined) this.umEtat.useProfiles = payload.useProfiles;
  }

  async enablePackage(_name: string) {
    if (this.umIgnoreLesEcritures) return;
    this.umEtat.paquetProgramme = 'enable';
  }

  async unschedulePackage(_name: string) {
    if (this.umIgnoreLesEcritures) return;
    this.umEtat.paquetProgramme = '';
  }

  // ---------- Outils de diagnostic ----------
  //
  // Ce simulacre modélise ce que le backend **écrit** : comptes, profils,
  // attributions, baux. Les écrans de diagnostic, eux, ne font que lire un
  // état que le routeur produit tout seul — ports cuivre, historique,
  // certificats, table de suivi. Il n'y a rien à simuler qu'on ne serait
  // en train d'inventer, et un jeu de données inventé ferait passer des
  // tests qui ne prouvent rien.
  //
  // Ils rendent donc un état vide, et c'est le contrat : un test qui a
  // besoin d'un cas particulier le pose lui-même avec un `jest.spyOn`,
  // plutôt que de dépendre de valeurs choisies ici.

  async getPortsEthernet(): Promise<EthernetPortDto[]> {
    return [];
  }

  async getHorloge(): Promise<HorlogeRouteurDto> {
    return {
      date: '1970-01-01',
      time: '00:00:00',
      timeZone: 'UTC',
      gmtOffset: '+00:00',
      dstActive: false,
      ntpEnabled: false,
      ntpStatus: '',
      ntpServers: [],
      ntpSyncedServer: null,
      ntpStratum: null,
      ntpOffsetMs: null,
      uptime: '0s',
    };
  }

  async getHistoriqueConfiguration(): Promise<ChangementRouteurDto[]> {
    return [];
  }

  async getSuiviConnexions(): Promise<SuiviConnexionsDto> {
    return { total: 0, maxEntries: 0, tcpEstablishedTimeout: '', clients: [] };
  }

  async getAcces(): Promise<{
    comptes: RouterAccountDto[];
    groupes: RouterAccountGroupDto[];
    exposition: RouterExpositionDto;
  }> {
    return {
      comptes: [],
      groupes: [],
      exposition: {
        macServerInterfaces: '',
        macPingEnabled: false,
        proxyEnabled: false,
        upnpEnabled: false,
        snmpEnabled: false,
      },
    };
  }

  async getCertificates(): Promise<CertificateDto[]> {
    return [];
  }

  async getAutomatisations(): Promise<{
    scripts: RouterScriptDto[];
    taches: RouterScheduleDto[];
  }> {
    return { scripts: [], taches: [] };
  }

  async getAddressPools(): Promise<AddressPoolDto[]> {
    return [];
  }

  async getWirelessInterfaces(): Promise<WirelessInterfaceDto[]> {
    return [];
  }

  async getWirelessClients(): Promise<WirelessClientDto[]> {
    return [];
  }

  async getRadiusClients(): Promise<RadiusClientDto[]> {
    return [];
  }

  async getWireguard(): Promise<{
    interfaces: WireguardInterfaceDto[];
    peers: WireguardPeerDto[];
  }> {
    return { interfaces: [], peers: [] };
  }

  async getStructureReseau(): Promise<{
    addresses: IpAddressDto[];
    bridges: BridgeDto[];
    ports: BridgePortDto[];
    dhcpClients: DhcpClientDto[];
  }> {
    return { addresses: [], bridges: [], ports: [], dhcpClients: [] };
  }

  /**
   * L'écriture de fichier, elle, est bien modélisée : elle sert aux planches
   * de tickets, et un test qui la croit muette manquerait une régression.
   */
  private fichiers = new Map<string, string>();

  async writeRouterFile(name: string, contents: string): Promise<void> {
    this.fichiers.set(name, contents);
  }

  async deleteRouterFile(id: string): Promise<void> {
    this.fichiers.delete(id);
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
