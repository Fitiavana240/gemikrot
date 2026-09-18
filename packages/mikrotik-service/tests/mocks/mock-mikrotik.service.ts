import { IMikrotikService } from '../../src/interfaces/mikrotik-service.interface';
import {
  ClockDto,
  NetworkInterfaceDto,
  NtpStatusDto,
  RadiusStatusDto,
  RouterIdentityDto,
  SystemResourceDto,
} from '../../src/dto/router.dto';
import { HotspotActiveUserDto, HotspotHostDto, HotspotProfileDto, HotspotUserDto } from '../../src/dto/hotspot.dto';
import {
  UserManagerLimitationDto,
  UserManagerProfileDto,
  UserManagerSessionDto,
  UserManagerUserDto,
  UserManagerUserProfileDto,
} from '../../src/dto/user-manager.dto';
import {
  AssignProfileDto,
  CreateProfileDto,
  CreateUserManagerUserDto,
  DisconnectHotspotUserDto,
  RemoveProfileAssignmentDto,
  UpdateProfileDto,
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
  private limitations = new Map<string, UserManagerLimitationDto>();
  private userProfiles: UserManagerUserProfileDto[] = [];
  private activeHotspotUsers: HotspotActiveUserDto[] = [];
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
    return [];
  }

  async getHotspotProfiles(): Promise<HotspotProfileDto[]> {
    return [];
  }

  async disconnectHotspotUser(input: DisconnectHotspotUserDto): Promise<void> {
    this.activeHotspotUsers = this.activeHotspotUsers.filter((u) => u.id !== input.sessionId);
  }

  // ---------- User Manager : lecture ----------

  async getUserManagerUsers(): Promise<UserManagerUserDto[]> {
    return [...this.users.values()];
  }

  async getUserManagerProfiles(): Promise<UserManagerProfileDto[]> {
    return [...this.limitations.values()].map((l) => ({ id: l.id, name: l.name }));
  }

  async getUserManagerLimitations(): Promise<UserManagerLimitationDto[]> {
    return [...this.limitations.values()];
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

  async createProfile(input: CreateProfileDto): Promise<UserManagerLimitationDto> {
    const limitation: UserManagerLimitationDto = {
      id: this.nextId(),
      name: input.name,
      validityDurationSeconds: input.validityDurationSeconds,
      startsWhen: input.startsWhen,
      rateLimit: {
        rxBitsPerSecond: input.rateLimitRxBitsPerSecond ?? null,
        txBitsPerSecond: input.rateLimitTxBitsPerSecond ?? null,
      },
      transferLimitBytes: input.transferLimitBytes ?? null,
      uptimeLimitSeconds: null,
    };
    this.limitations.set(input.name, limitation);
    return limitation;
  }

  async updateProfile(input: UpdateProfileDto): Promise<UserManagerLimitationDto> {
    const existing = this.limitations.get(input.name);
    if (!existing) {
      throw new MikrotikNotFoundError('Profil User Manager', input.name);
    }
    const updated: UserManagerLimitationDto = {
      ...existing,
      validityDurationSeconds: input.validityDurationSeconds ?? existing.validityDurationSeconds,
      startsWhen: input.startsWhen ?? existing.startsWhen,
      rateLimit: {
        rxBitsPerSecond: input.rateLimitRxBitsPerSecond ?? existing.rateLimit.rxBitsPerSecond,
        txBitsPerSecond: input.rateLimitTxBitsPerSecond ?? existing.rateLimit.txBitsPerSecond,
      },
      transferLimitBytes: input.transferLimitBytes ?? existing.transferLimitBytes,
    };
    this.limitations.set(input.name, updated);
    return updated;
  }

  async assignProfile(input: AssignProfileDto): Promise<UserManagerUserProfileDto> {
    if (!this.users.has(input.username)) {
      throw new MikrotikNotFoundError('Utilisateur User Manager', input.username);
    }
    const assignment: UserManagerUserProfileDto = {
      id: this.nextId(),
      username: input.username,
      profileName: input.profileName,
      activatedAt: new Date().toISOString(),
      expiresAt: null,
      state: 'active',
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

  // ---------- Aides de test ----------

  /** Permet à un test de préparer un état (ex : simuler une session active). */
  seedActiveHotspotUser(user: HotspotActiveUserDto): void {
    this.activeHotspotUsers.push(user);
  }
}
