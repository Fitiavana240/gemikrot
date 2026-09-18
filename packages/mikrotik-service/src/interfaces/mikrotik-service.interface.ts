import {
  ClockDto,
  NetworkInterfaceDto,
  NtpStatusDto,
  RadiusStatusDto,
  RouterIdentityDto,
  SystemResourceDto,
} from '../dto/router.dto';
import { HotspotActiveUserDto, HotspotHostDto, HotspotProfileDto, HotspotUserDto } from '../dto/hotspot.dto';
import {
  UserManagerLimitationDto,
  UserManagerProfileDto,
  UserManagerSessionDto,
  UserManagerUserDto,
  UserManagerUserProfileDto,
} from '../dto/user-manager.dto';
import {
  AssignProfileDto,
  CreateProfileDto,
  CreateUserManagerUserDto,
  DisconnectHotspotUserDto,
  RemoveProfileAssignmentDto,
  UpdateProfileDto,
} from '../dto/commands.dto';

/**
 * Contrat UNIQUE par lequel le reste du backend (services métier,
 * contrôleurs HTTP) accède au MikroTik.
 *
 * Règle d'architecture non négociable : aucune couche en dehors du dossier
 * `mikrotik/` ne doit importer `RouterOSRestClient`, un mapper, ou
 * connaître un quelconque vocabulaire RouterOS (chemins REST, clés
 * kebab-case, codes d'erreur bruts). Elle dépend uniquement de cette
 * interface et des DTOs qu'elle expose.
 *
 * Toute implémentation (REST actuelle, future implémentation API binaire,
 * mock de test) doit respecter strictement ce contrat, y compris la
 * sémantique des erreurs (`MikrotikError` et ses sous-classes définies
 * dans `errors/mikrotik.errors.ts`).
 */
export interface IMikrotikService {
  // ---------- Système / monitoring ----------

  getRouterIdentity(): Promise<RouterIdentityDto>;
  getSystemResource(): Promise<SystemResourceDto>;
  getInterfaces(): Promise<NetworkInterfaceDto[]>;
  getClock(): Promise<ClockDto>;
  getNtpStatus(): Promise<NtpStatusDto>;
  getRadiusStatus(): Promise<RadiusStatusDto>;

  // ---------- HotSpot ----------

  getHotspotActiveUsers(): Promise<HotspotActiveUserDto[]>;
  getHotspotHosts(): Promise<HotspotHostDto[]>;
  getHotspotUsers(): Promise<HotspotUserDto[]>;
  getHotspotProfiles(): Promise<HotspotProfileDto[]>;
  disconnectHotspotUser(input: DisconnectHotspotUserDto): Promise<void>;

  // ---------- User Manager : lecture ----------

  getUserManagerUsers(): Promise<UserManagerUserDto[]>;
  getUserManagerProfiles(): Promise<UserManagerProfileDto[]>;
  getUserManagerLimitations(): Promise<UserManagerLimitationDto[]>;
  /** Sans argument : toutes les associations. Avec `username` : filtré. */
  getUserManagerUserProfiles(username?: string): Promise<UserManagerUserProfileDto[]>;
  /** Sans argument : toutes les sessions. Avec `username` : filtré. */
  getUserManagerSessions(username?: string): Promise<UserManagerSessionDto[]>;

  // ---------- User Manager : écriture ----------

  createUserManagerUser(input: CreateUserManagerUserDto): Promise<UserManagerUserDto>;
  deleteUserManagerUser(username: string): Promise<void>;
  createProfile(input: CreateProfileDto): Promise<UserManagerLimitationDto>;
  updateProfile(input: UpdateProfileDto): Promise<UserManagerLimitationDto>;
  assignProfile(input: AssignProfileDto): Promise<UserManagerUserProfileDto>;
  removeProfile(input: RemoveProfileAssignmentDto): Promise<void>;
}
