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
  HotspotServerDto,
  HotspotServerProfileDto,
  HotspotUserDto,
  IpBindingDto,
  IpBindingType,
  WalledGardenEntryDto,
  WalledGardenIpEntryDto,
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
  CreateWalledGardenEntryDto,
  CreateWalledGardenIpEntryDto,
  DisconnectHotspotUserDto,
  RemoveProfileAssignmentDto,
  UpdateHotspotProfileDto,
  UpdateHotspotUserDto,
  UpdateLimitationDto,
  UpdateProfileDto,
  UpdateUserManagerUserDto,
  CreatePppSecretDto,
} from '../dto/commands.dto';
import {
  IpPoolDto,
  PppActiveDto,
  PppProfileDto,
  PppSecretDto,
  PppoeServerDto,
} from '../dto/ppp.dto';
import {
  HotspotServicePortDto,
  UmAttributeDto,
  UmRouterDto,
  UmUserGroupDto,
} from '../dto/router-config.dto';

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

  // ---------- Serveurs HotSpot (lecture) ----------

  getHotspotServers(): Promise<HotspotServerDto[]>;
  /** Porte `login-by` et la durée de vie des cookies : la portée réelle
   *  d'une suspension en dépend. */
  getHotspotServerProfiles(): Promise<HotspotServerProfileDto[]>;

  // ---------- Walled Garden ----------

  /**
   * Ce qu'un client peut joindre avant de s'authentifier. Sans entrée, une
   * page de paiement hébergée hors du routeur est inatteignable pour qui
   * n'a pas encore de code d'accès.
   */
  getWalledGarden(): Promise<WalledGardenEntryDto[]>;
  createWalledGardenEntry(input: CreateWalledGardenEntryDto): Promise<WalledGardenEntryDto>;
  deleteWalledGardenEntry(id: string): Promise<void>;
  getWalledGardenIps(): Promise<WalledGardenIpEntryDto[]>;
  createWalledGardenIpEntry(input: CreateWalledGardenIpEntryDto): Promise<WalledGardenIpEntryDto>;
  deleteWalledGardenIpEntry(id: string): Promise<void>;

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
  /** Supprime le compte **et ses attributions** : RouterOS laisse sinon des
   *  orphelines qui bloquent la suppression du profil. */
  deleteUserManagerUser(username: string): Promise<void>;
  /** Retire les attributions dont le compte n'existe plus. */
  pruneOrphanAssignments(): Promise<number>;
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

  // ---------- PPPoE ----------

  /**
   * L'autre façon de vendre l'accès : l'abonné ouvre une session
   * authentifiée au lieu de saisir un code sur une page captive. Sert le
   * marché des abonnements à domicile, que le HotSpot ne couvre pas.
   *
   * Formes relevées sur un hAP ac² en 7.24.4 et figées dans
   * `tests/mappers/ppp.spec.ts`, à l'exception des sessions actives, qu'aucun
   * relevé ne peut produire sans un abonné réellement connecté.
   */
  getPppSecrets(): Promise<PppSecretDto[]>;
  /** C'est le profil qui porte le débit et l'adressage, pas le compte. */
  getPppProfiles(): Promise<PppProfileDto[]>;
  getPppActive(): Promise<PppActiveDto[]>;
  getPppoeServers(): Promise<PppoeServerDto[]>;
  /** Les bassins d'adresses, que les profils désignent par leur nom. */
  getIpPools(): Promise<IpPoolDto[]>;

  createPppSecret(input: CreatePppSecretDto): Promise<PppSecretDto>;
  /**
   * Suspendre ne coupe pas la session en cours : PPPoE ne revérifie
   * l'authentification qu'à la reconnexion. Pour couper tout de suite,
   * fermer aussi la session avec `disconnectPppActive`.
   */
  setPppSecretDisabled(username: string, disabled: boolean): Promise<PppSecretDto>;
  deletePppSecret(username: string): Promise<void>;
  disconnectPppActive(id: string): Promise<void>;

  // ---------- Tables de configuration ----------
  //
  // Ce que WinBox montre et que la console ignorait. Lecture seule pour
  // l'instant : les modifier suppose de comprendre ce qu'on casse, et le
  // relevé des charges utiles ne dit pas encore quelles ecritures sont sures.

  /** Clients RADIUS declares dans User Manager. Le secret ne sort jamais. */
  getUmRouters(): Promise<UmRouterDto[]>;
  /** Groupes d'authentification : methodes acceptees dedans et dehors. */
  getUmUserGroups(): Promise<UmUserGroupDto[]>;
  /** Attributs RADIUS connus, standards et constructeurs. */
  getUmAttributes(): Promise<UmAttributeDto[]>;
  /** Protocoles dont le HotSpot suit les connexions (`ftp`, `sip`...). */
  getHotspotServicePorts(): Promise<HotspotServicePortDto[]>;
}

