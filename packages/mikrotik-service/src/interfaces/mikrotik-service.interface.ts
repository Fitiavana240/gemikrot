import {
  ClockDto,
  NetworkInterfaceDto,
  NtpStatusDto,
  RadiusStatusDto,
  RouterIdentityDto,
  SystemResourceDto,
} from '../dto/router.dto';
import {
  DhcpLeaseDto,
  HotspotActiveUserDto,
  HotspotCookieDto,
  HotspotHostDto,
  HotspotProfileDto,
  HotspotUserDto,
  IpBindingDto,
  IpBindingType,
} from '../dto/hotspot.dto';
import {
  UserManagerLimitationDto,
  UserManagerProfileDto,
  UserManagerProfileLimitationDto,
  UserManagerSessionDto,
  UserManagerUserDto,
  UserManagerUserProfileDto,
} from '../dto/user-manager.dto';
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

  // ---------- HotSpot : écriture (base AAA réellement exploitée) ----------

  createHotspotUser(input: CreateHotspotUserDto): Promise<HotspotUserDto>;
  updateHotspotUser(input: UpdateHotspotUserDto): Promise<HotspotUserDto>;
  /** Suspension / réactivation d'un abonné sans perdre son compte. */
  setHotspotUserDisabled(username: string, disabled: boolean): Promise<HotspotUserDto>;
  deleteHotspotUser(username: string): Promise<void>;

  /**
   * Cookies de connexion. Les purger est indispensable pour couper
   * réellement un accès : un cookie vivant rouvre la session sans RADIUS,
   * donc sans consulter la validité User Manager.
   */
  getHotspotCookies(): Promise<HotspotCookieDto[]>;
  deleteHotspotCookie(id: string): Promise<void>;

  createHotspotProfile(input: CreateHotspotProfileDto): Promise<HotspotProfileDto>;
  updateHotspotProfile(input: UpdateHotspotProfileDto): Promise<HotspotProfileDto>;

  // ---------- Contournement du portail captif ----------

  getIpBindings(): Promise<IpBindingDto[]>;
  createIpBinding(input: CreateIpBindingDto): Promise<IpBindingDto>;
  /** `bypassed` (accès sans portail) ↔ `blocked` (suspension d'un abonné). */
  setIpBindingType(id: string, type: IpBindingType): Promise<IpBindingDto>;
  deleteIpBinding(id: string): Promise<void>;

  /** Baux DHCP — seule source côté routeur pour deviner le type d'appareil. */
  getDhcpLeases(): Promise<DhcpLeaseDto[]>;

  // ---------- User Manager : lecture ----------

  getUserManagerUsers(): Promise<UserManagerUserDto[]>;
  /** Les offres : c'est ici que vivent `validity` et `starts-when`. */
  getUserManagerProfiles(): Promise<UserManagerProfileDto[]>;
  /** Les limitations de débit/quota, rattachées aux profils par jonction. */
  getUserManagerLimitations(): Promise<UserManagerLimitationDto[]>;
  getUserManagerProfileLimitations(): Promise<UserManagerProfileLimitationDto[]>;
  /** Sans argument : toutes les associations. Avec `username` : filtré. */
  getUserManagerUserProfiles(username?: string): Promise<UserManagerUserProfileDto[]>;
  /** Sans argument : toutes les sessions. Avec `username` : filtré. */
  getUserManagerSessions(username?: string): Promise<UserManagerSessionDto[]>;

  // ---------- User Manager : écriture ----------

  createUserManagerUser(input: CreateUserManagerUserDto): Promise<UserManagerUserDto>;
  /**
   * Création en lot. La liste des comptes existants n'est relue qu'une fois,
   * là où un appel unitaire répété la relit à chaque création — intenable
   * pour un lot de tickets sur un parc qui grossit.
   */
  createUserManagerUsers(inputs: CreateUserManagerUserDto[]): Promise<UserManagerUserDto[]>;
  /** Rotation du mot de passe d'un compte existant, sans perdre son historique. */
  updateUserManagerUser(input: UpdateUserManagerUserDto): Promise<UserManagerUserDto>;
  deleteUserManagerUser(username: string): Promise<void>;
  /** Suspension d'un abonné sans perdre son compte (Section 5). */
  setUserManagerUserDisabled(username: string, disabled: boolean): Promise<UserManagerUserDto>;
  createProfile(input: CreateProfileDto): Promise<UserManagerProfileDto>;
  updateProfile(input: UpdateProfileDto): Promise<UserManagerProfileDto>;
  deleteProfile(name: string): Promise<void>;
  assignProfile(input: AssignProfileDto): Promise<UserManagerUserProfileDto>;
  removeProfile(input: RemoveProfileAssignmentDto): Promise<void>;

  // ---------- User Manager : limitations de débit et de volume ----------

  createLimitation(input: CreateLimitationDto): Promise<UserManagerLimitationDto>;
  updateLimitation(input: UpdateLimitationDto): Promise<UserManagerLimitationDto>;
  deleteLimitation(name: string): Promise<void>;
  attachLimitationToProfile(input: AttachLimitationDto): Promise<UserManagerProfileLimitationDto>;
  detachLimitationFromProfile(input: AttachLimitationDto): Promise<void>;
}
