import { IMikrotikService } from './interfaces/mikrotik-service.interface';
import { RouterOSRestClient } from './client/routeros-rest-client';
import { ILogger } from './logging/logger.interface';
import * as RouterMapper from './mappers/router.mapper';
import * as HotspotMapper from './mappers/hotspot.mapper';
import * as UmMapper from './mappers/user-manager.mapper';
import * as PppMapper from './mappers/ppp.mapper';
import * as ConfigMapper from './mappers/router-config.mapper';
import * as ToolsMapper from './mappers/router-tools.mapper';
import * as StorageMapper from './mappers/router-storage.mapper';
import { validate } from './validation/validate';
import {
  assignProfileSchema,
  attachLimitationSchema,
  createHotspotProfileSchema,
  createHotspotUserSchema,
  createIpBindingSchema,
  createLimitationSchema,
  createWalledGardenEntrySchema,
  createWalledGardenIpEntrySchema,
  createProfileSchema,
  createUserManagerUserSchema,
  disconnectHotspotUserSchema,
  hotspotUsernameParamSchema,
  ipBindingTypeSchema,
  limitationNameParamSchema,
  profileNameParamSchema,
  removeProfileAssignmentSchema,
  routerosIdSchema,
  updateHotspotProfileSchema,
  updateHotspotUserSchema,
  updateLimitationSchema,
  updateProfileSchema,
  updateUserManagerUserSchema,
  usernameParamSchema,
  createPppSecretSchema,
  updatePppSecretSchema,
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
  UpdatePppSecretDto,
} from './dto/commands.dto';
import { IpBindingType } from './dto/hotspot.dto';
import type { UserManagerUserDto } from './dto/user-manager.dto';
import {
  MikrotikConflictError,
  MikrotikNotFoundError,
  MikrotikValidationError,
} from './errors/mikrotik.errors';

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
  if (data.downloadLimitBytes !== undefined) {
    payload['download-limit'] = data.downloadLimitBytes ?? 0;
  }
  if (data.uploadLimitBytes !== undefined) {
    payload['upload-limit'] = data.uploadLimitBytes ?? 0;
  }
  if (data.uptimeLimitSeconds !== undefined) {
    payload['uptime-limit'] = data.uptimeLimitSeconds != null ? `${data.uptimeLimitSeconds}s` : '0s';
  }
  if (data.resetCountersIntervalSeconds !== undefined) {
    // `disabled` et non `0s` : c'est le mot que RouterOS rend quand rien ne se
    // remet à zéro, et lui envoyer une durée nulle ne désactive pas le cycle.
    payload['reset-counters-interval'] =
      data.resetCountersIntervalSeconds != null ? `${data.resetCountersIntervalSeconds}s` : 'disabled';
  }
  if (data.resetCountersStartTime !== undefined) {
    payload['reset-counters-start-time'] = data.resetCountersStartTime ?? '1970-01-01 00:00:00';
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
/**
 * Une durée RouterOS, ou `0s` pour la retirer.
 *
 * `null` veut dire « enlever la limite » et `undefined` « ne pas y toucher » :
 * les confondre effacerait un réglage qu'on ne voulait pas modifier. RouterOS
 * n'accepte pas une chaîne vide sur ces champs, il attend `0s`.
 */
function duréeOuRien(secondes: number | null | undefined): string | undefined {
  if (secondes === undefined) return undefined;
  return secondes === null ? '0s' : `${secondes}s`;
}

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
      // RouterOS attend une durée, pas un nombre : `7200s` est accepté et
      // relu `2h`. Le parc n'en pose que sur 400 de ses 646 comptes, d'où
      // l'omission pure et simple quand il n'y en a pas — un `0` créerait
      // un plafond nul, donc un compte inutilisable.
      ...(data.limitUptimeSeconds != null
        ? { 'limit-uptime': `${data.limitUptimeSeconds}s` }
        : {}),
      // Même règle pour les quotas : omis plutôt que posés à zéro, un
      // plafond nul rendant le compte inutilisable dès le premier octet.
      ...(data.limitBytesIn != null ? { 'limit-bytes-in': data.limitBytesIn } : {}),
      ...(data.limitBytesOut != null ? { 'limit-bytes-out': data.limitBytesOut } : {}),
      ...(data.limitBytesTotal != null ? { 'limit-bytes-total': data.limitBytesTotal } : {}),
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
    if (data.server !== undefined) payload.server = data.server;
    if (data.limitUptimeSeconds !== undefined) {
      // `null` veut dire « retirer le plafond », que RouterOS exprime par
      // `0s`. Éprouvé sur le hAP : le champ disparaît ensuite de la lecture,
      // exactement comme sur un compte qui n'en a jamais eu.
      payload['limit-uptime'] =
        data.limitUptimeSeconds != null ? `${data.limitUptimeSeconds}s` : '0s';
    }
    // Les trois quotas suivent la même convention : `null` retire, absent ne
    // touche pas. RouterOS exprime « aucun plafond » par zéro sur ces champs.
    if (data.limitBytesIn !== undefined) payload['limit-bytes-in'] = data.limitBytesIn ?? 0;
    if (data.limitBytesOut !== undefined) payload['limit-bytes-out'] = data.limitBytesOut ?? 0;
    if (data.limitBytesTotal !== undefined) {
      payload['limit-bytes-total'] = data.limitBytesTotal ?? 0;
    }

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
      'idle-timeout': duréeOuRien(data.idleTimeoutSeconds),
      'keepalive-timeout': duréeOuRien(data.keepaliveTimeoutSeconds),
      'mac-cookie-timeout': duréeOuRien(data.macCookieTimeoutSeconds),
    });

    /**
     * `add-mac-cookie` ne se pose pas à la création.
     *
     * Éprouvé sur le hAP en 7.24.4 : envoyé dans le `PUT`, il est **ignoré en
     * silence** — le profil revient avec `true`, la valeur par défaut, sans la
     * moindre erreur. Le même champ dans un `PATCH` est accepté et relu
     * `false`. Un profil créé « sans cookie » en aurait donc posé quand même,
     * et le blocage d'un compte serait resté sans effet immédiat.
     */
    if (data.addMacCookie === false) {
      const corrigé = await this.client.patch<any>(
        `/ip/hotspot/user/profile/${raw['.id']}`,
        { 'add-mac-cookie': 'false' },
      );
      return HotspotMapper.mapHotspotProfile(corrigé);
    }
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
    if (data.idleTimeoutSeconds !== undefined) {
      payload['idle-timeout'] = duréeOuRien(data.idleTimeoutSeconds);
    }
    if (data.keepaliveTimeoutSeconds !== undefined) {
      payload['keepalive-timeout'] = duréeOuRien(data.keepaliveTimeoutSeconds);
    }
    if (data.macCookieTimeoutSeconds !== undefined) {
      payload['mac-cookie-timeout'] = duréeOuRien(data.macCookieTimeoutSeconds);
    }

    this.logger.info('Mise à jour profil HotSpot', { name: data.name });
    let raw = await this.client.patch<any>(`/ip/hotspot/user/profile/${target.id}`, payload);

    /**
     * `add-mac-cookie` part **seul**, et en dernier.
     *
     * Éprouvé sur le hAP en 7.24.4, trois requêtes de suite :
     *
     * | Envoyé | Relu |
     * |---|---|
     * | `add-mac-cookie=false` seul | `false` |
     * | avec `shared-users` et `idle-timeout` | `false` |
     * | **avec `mac-cookie-timeout`** | **`true`** |
     *
     * Régler la durée de vie du cookie **réactive le cookie**, silencieusement,
     * même quand la même requête demande de le couper. Un exploitant qui
     * décocherait la case en ajustant la durée aurait donc obtenu l'inverse de
     * ce qu'il a demandé — sans la moindre erreur pour l'avertir.
     */
    if (data.addMacCookie !== undefined) {
      raw = await this.client.patch<any>(`/ip/hotspot/user/profile/${target.id}`, {
        'add-mac-cookie': String(data.addMacCookie),
      });
    }
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

  // ============ Serveurs HotSpot et Walled Garden ============

  async getHotspotServers() {
    const raw = await this.client.get<any[]>('/ip/hotspot');
    return raw.map(HotspotMapper.mapHotspotServer);
  }

  async getHotspotServerProfiles() {
    const raw = await this.client.get<any[]>('/ip/hotspot/profile');
    return raw.map(HotspotMapper.mapHotspotServerProfile);
  }

  async getWalledGarden() {
    const raw = await this.client.get<any[]>('/ip/hotspot/walled-garden');
    return raw.map(HotspotMapper.mapWalledGardenEntry);
  }

  async createWalledGardenEntry(input: CreateWalledGardenEntryDto) {
    const data = validate(createWalledGardenEntrySchema, input);
    this.logger.info('Ouverture Walled Garden', { host: data.dstHost });
    const raw = await this.client.put<any>('/ip/hotspot/walled-garden', {
      'dst-host': data.dstHost,
      action: data.action ?? 'allow',
      'dst-port': data.dstPort,
      comment: data.comment,
    });
    return HotspotMapper.mapWalledGardenEntry(raw);
  }

  async deleteWalledGardenEntry(id: string) {
    const validId = validate(routerosIdSchema, id);
    this.logger.info('Retrait Walled Garden', { id: validId });
    await this.client.delete(`/ip/hotspot/walled-garden/${encodeURIComponent(validId)}`);
  }

  async getWalledGardenIps() {
    const raw = await this.client.get<any[]>('/ip/hotspot/walled-garden/ip');
    return raw.map(HotspotMapper.mapWalledGardenIpEntry);
  }

  /**
   * La liste par adresse n'emploie pas le même vocabulaire que la liste par
   * domaine : l'action y est `accept`, pas `allow`. Relevé sur le routeur.
   */
  async createWalledGardenIpEntry(input: CreateWalledGardenIpEntryDto) {
    const data = validate(createWalledGardenIpEntrySchema, input);
    this.logger.info('Ouverture Walled Garden IP', { address: data.dstAddress });
    const raw = await this.client.put<any>('/ip/hotspot/walled-garden/ip', {
      'dst-address': data.dstAddress,
      action: data.action ?? 'accept',
      'dst-port': data.dstPort,
      protocol: data.protocol,
      comment: data.comment,
    });
    return HotspotMapper.mapWalledGardenIpEntry(raw);
  }

  async deleteWalledGardenIpEntry(id: string) {
    const validId = validate(routerosIdSchema, id);
    this.logger.info('Retrait Walled Garden IP', { id: validId });
    await this.client.delete(`/ip/hotspot/walled-garden/ip/${encodeURIComponent(validId)}`);
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

  /**
   * Paiements notés par le routeur lui-même.
   *
   * Vide sur le parc : l'encaissement passe par Mobile Money, hors routeur.
   * Les noms de champs viennent donc des colonnes de WinBox et non d'un
   * relevé — l'écran qui l'affiche le dit.
   */
  async getUserManagerPayments() {
    const raw = await this.client.get<any[]>('/user-manager/payment');
    return raw.map(UmMapper.mapUserManagerPayment);
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

  /**
   * Supprime un compte **et ses attributions de profil**.
   *
   * RouterOS ne fait pas le ménage : il conserve les entrées de
   * `/user-manager/user-profile` et y remplace simplement le nom du compte
   * par son identifiant interne. Ces attributions orphelines empêchent
   * ensuite définitivement de supprimer le profil, qui se croit encore
   * utilisé. Relevé sur le hAP après une série de suppressions.
   */
  async deleteUserManagerUser(username: string) {
    const validUsername = validate(usernameParamSchema, username);
    const existing = await this.findUserManagerUserByUsername(validUsername);
    if (!existing) {
      throw new MikrotikNotFoundError('Utilisateur User Manager', validUsername);
    }

    const assignments = await this.getUserManagerUserProfiles(validUsername);
    for (const assignment of assignments) {
      await this.client.delete(`/user-manager/user-profile/${assignment.id}`);
    }

    this.logger.info('Suppression utilisateur User Manager', {
      username: validUsername,
      assignments: assignments.length,
    });
    await this.client.delete(`/user-manager/user/${existing.id}`);
  }

  /**
   * Retire les attributions dont le compte n'existe plus. Sans ce ménage, un
   * profil reste indéfiniment « utilisé » par des comptes disparus.
   */
  async pruneOrphanAssignments(): Promise<number> {
    const [assignments, users] = await Promise.all([
      this.getUserManagerUserProfiles(),
      this.getUserManagerUsers(),
    ]);
    const known = new Set(users.map((user) => user.username));

    let removed = 0;
    for (const assignment of assignments) {
      if (known.has(assignment.username)) continue;
      await this.client.delete(`/user-manager/user-profile/${assignment.id}`);
      removed += 1;
    }
    if (removed > 0) {
      this.logger.info('Attributions orphelines retirées', { count: removed });
    }
    return removed;
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


  // ---------- PPPoE ----------

  /**
   * Les comptes PPPoE. Le débit ne se lit pas ici : il vit sur le profil,
   * contrairement au HotSpot où chaque compte peut porter le sien.
   */
  async getPppSecrets() {
    const raw = await this.client.get<any[]>('/ppp/secret');
    return raw.map(PppMapper.mapPppSecret);
  }

  async getPppProfiles() {
    const raw = await this.client.get<any[]>('/ppp/profile');
    return raw.map(PppMapper.mapPppProfile);
  }

  /** Les sessions en cours. Vide tant qu'aucun abonné n'est connecté. */
  async getPppActive() {
    const raw = await this.client.get<any[]>('/ppp/active');
    return raw.map(PppMapper.mapPppActive);
  }

  async getPppoeServers() {
    const raw = await this.client.get<any[]>('/interface/pppoe-server/server');
    return raw.map(PppMapper.mapPppoeServer);
  }

  /** Les bassins d'adresses, que les profils désignent par leur nom. */
  async getIpPools() {
    const raw = await this.client.get<any[]>('/ip/pool');
    return raw.map(PppMapper.mapIpPool);
  }

  async createPppSecret(input: CreatePppSecretDto) {
    const data = validate(createPppSecretSchema, input);

    const existing = await this.findPppSecretByUsername(data.username);
    if (existing) {
      throw new MikrotikConflictError(`Le compte PPPoE "${data.username}" existe déjà`, {
        username: data.username,
      });
    }

    this.logger.info('Création compte PPPoE', { username: data.username });
    const raw = await this.client.put<any>('/ppp/secret', {
      name: data.username,
      password: data.password,
      service: data.service ?? 'pppoe',
      ...(data.profile ? { profile: data.profile } : {}),
      ...(data.remoteAddress ? { 'remote-address': data.remoteAddress } : {}),
      ...(data.comment ? { comment: data.comment } : {}),
    });
    return PppMapper.mapPppSecret(raw);
  }

  /**
   * Modification d'un compte PPPoE.
   *
   * N'écrit que les champs fournis : renvoyer tout le formulaire écraserait
   * un réglage posé ailleurs — le profil notamment, qui porte le débit.
   *
   * Comme la suspension, le changement ne touche pas une session en cours :
   * PPPoE ne revérifie rien avant la reconnexion. Changer le profil d'un
   * abonné connecté ne change pas son débit tant qu'il reste en ligne ;
   * fermer sa session avec `disconnectPppActive` l'applique tout de suite.
   */
  async updatePppSecret(username: string, input: UpdatePppSecretDto) {
    const validUsername = validate(usernameParamSchema, username);
    const data = validate(updatePppSecretSchema, input);

    const existing = await this.findPppSecretByUsername(validUsername);
    if (!existing) throw new MikrotikNotFoundError('Compte PPPoE', validUsername);

    const payload: Record<string, string> = {};
    if (data.password !== undefined) payload.password = data.password;
    if (data.profile !== undefined) payload.profile = data.profile;
    if (data.service !== undefined) payload.service = data.service;
    if (data.remoteAddress !== undefined) payload['remote-address'] = data.remoteAddress;
    if (data.comment !== undefined) payload.comment = data.comment;

    // Les noms des champs touchés, pas leurs valeurs : un mot de passe n'a
    // rien à faire dans un journal.
    this.logger.info('Modification compte PPPoE', {
      username: validUsername,
      champs: Object.keys(payload),
    });
    const raw = await this.client.patch<any>(`/ppp/secret/${existing.id}`, payload);
    return PppMapper.mapPppSecret(raw);
  }

  /**
   * Suspend ou réactive un abonné. Désactiver le compte n'interrompt pas la
   * session en cours : PPPoE ne revérifie l'authentification qu'à la
   * reconnexion. Pour couper tout de suite, fermer aussi la session.
   */
  async setPppSecretDisabled(username: string, disabled: boolean) {
    const validUsername = validate(usernameParamSchema, username);
    const existing = await this.findPppSecretByUsername(validUsername);
    if (!existing) throw new MikrotikNotFoundError('Compte PPPoE', validUsername);

    this.logger.info(disabled ? 'Suspension abonné PPPoE' : 'Réactivation abonné PPPoE', {
      username: validUsername,
    });
    const raw = await this.client.patch<any>(`/ppp/secret/${existing.id}`, {
      disabled: disabled ? 'true' : 'false',
    });
    return PppMapper.mapPppSecret(raw);
  }

  async deletePppSecret(username: string) {
    const validUsername = validate(usernameParamSchema, username);
    const existing = await this.findPppSecretByUsername(validUsername);
    if (!existing) throw new MikrotikNotFoundError('Compte PPPoE', validUsername);

    this.logger.info('Suppression compte PPPoE', { username: validUsername });
    await this.client.delete(`/ppp/secret/${existing.id}`);
  }

  /** Ferme une session en cours, sans toucher au compte. */
  async disconnectPppActive(id: string) {
    this.logger.info('Fermeture session PPPoE', { id });
    await this.client.delete(`/ppp/active/${id}`);
  }

  private async findPppSecretByUsername(username: string) {
    const secrets = await this.getPppSecrets();
    return secrets.find((secret) => secret.username === username) ?? null;
  }


  // ---------- Tables de configuration ----------

  /**
   * Clients RADIUS de User Manager.
   *
   * Le secret partage est retire par la correspondance, pas ici : le retirer
   * au plus pres de la lecture garantit qu'aucun appelant ne le voit, quelle
   * que soit la facon dont il obtient la liste.
   */
  async getUmRouters() {
    const raw = await this.client.get<any[]>('/user-manager/router');
    return raw.map(ConfigMapper.mapUmRouter);
  }

  async getUmUserGroups() {
    const raw = await this.client.get<any[]>('/user-manager/user/group');
    return raw.map(ConfigMapper.mapUmUserGroup);
  }

  async getUmAttributes() {
    const raw = await this.client.get<any[]>('/user-manager/attribute');
    return raw.map(ConfigMapper.mapUmAttribute);
  }

  async getHotspotServicePorts() {
    const raw = await this.client.get<any[]>('/ip/hotspot/service-port');
    return raw.map(ConfigMapper.mapHotspotServicePort);
  }


  // ---------- Diagnostic et debit ----------

  async getSimpleQueues() {
    const raw = await this.client.get<any[]>('/queue/simple');
    return raw.map(ToolsMapper.mapSimpleQueue);
  }

  /**
   * Journal du routeur, du plus recent au plus ancien.
   *
   * Le routeur en garde un millier de lignes : les rendre toutes chargerait
   * l'ecran pour rien. RouterOS ne sait pas trier a la source, on inverse
   * donc apres lecture.
   */
  async getRouterLog(limit = 200) {
    const raw = await this.client.get<any[]>('/log');
    return raw
      .slice(-limit)
      .reverse()
      .map(ToolsMapper.mapRouterLogEntry);
  }

  async getInterfaceStats() {
    const raw = await this.client.get<any[]>('/interface');
    return raw.map(ToolsMapper.mapNetworkInterfaceStats);
  }

  async getIpServices() {
    const raw = await this.client.get<any[]>('/ip/service');
    return raw.map(ToolsMapper.mapIpService);
  }

  /** `/ip/cloud` rend un objet et non une liste : un routeur, un reglage. */
  async getIpCloud() {
    const raw = await this.client.get<any>('/ip/cloud');
    return ToolsMapper.mapIpCloud(Array.isArray(raw) ? raw[0] : raw);
  }

  async getArpEntries() {
    const raw = await this.client.get<any[]>('/ip/arp');
    return raw.map(ToolsMapper.mapArpEntry);
  }

  async getDhcpServers() {
    const raw = await this.client.get<any[]>('/ip/dhcp-server');
    return raw.map(ToolsMapper.mapDhcpServer);
  }


  // ---------- Pare-feu, DNS, routes ----------

  async getFirewallFilterRules() {
    const raw = await this.client.get<any[]>('/ip/firewall/filter');
    return raw.map((regle, index) => ToolsMapper.mapFirewallRule(regle, index));
  }

  async getFirewallNatRules() {
    const raw = await this.client.get<any[]>('/ip/firewall/nat');
    return raw.map((regle, index) => ToolsMapper.mapFirewallRule(regle, index));
  }

  async getDnsSettings() {
    const raw = await this.client.get<any>('/ip/dns');
    return ToolsMapper.mapDnsSettings(Array.isArray(raw) ? raw[0] : raw);
  }

  async getDnsStaticEntries() {
    const raw = await this.client.get<any[]>('/ip/dns/static');
    return raw.map(ToolsMapper.mapDnsStaticEntry);
  }

  async getRoutes() {
    const raw = await this.client.get<any[]>('/ip/route');
    return raw.map(ToolsMapper.mapRoute);
  }

  // ---------- Sans fil et RADIUS ----------

  /**
   * Les radios du routeur.
   *
   * À lire en sachant que **le routeur n'est pas forcément celui qui diffuse** :
   * sur ce parc, ses deux radios sont activées mais à l'arrêt, et le Wi-Fi
   * vient de bornes branchées sur les ports Ethernet. Une radio « activée »
   * qui n'émet pas n'est pas une panne, c'est un choix d'installation — mais
   * il faut pouvoir le voir.
   */
  async getWirelessInterfaces() {
    const raw = await this.client.get<any[]>('/interface/wireless');
    return raw.map(ToolsMapper.mapWirelessInterface);
  }

  /** Les clients associés aux radios, avec la qualité de leur liaison. */
  async getWirelessClients() {
    const raw = await this.client.get<any[]>('/interface/wireless/registration-table');
    return raw.map(ToolsMapper.mapWirelessClient);
  }

  /**
   * Le client RADIUS — la pièce qui relie le HotSpot à User Manager.
   *
   * Sans entrée active pour le service `hotspot`, aucun ticket n'est vérifié,
   * quoi que porte la base des comptes. C'est le genre de réglage qu'on ne
   * regarde jamais jusqu'au jour où plus rien n'ouvre.
   */
  async getRadiusClients() {
    const raw = await this.client.get<any[]>('/radius');
    return raw.map(ToolsMapper.mapRadiusClient);
  }

  /**
   * Le tunnel côté routeur : l'interface et ses pairs.
   *
   * Sans cette lecture, l'accès à distance n'est ni vérifiable ni dépannable :
   * WireGuard n'a pas d'état « connecté », et une interface qui tourne ne dit
   * rien du lien. Seule la dernière poignée de main le dit.
   */
  async getWireguard() {
    const [interfaces, peers] = await Promise.all([
      this.client.get<any[]>('/interface/wireguard'),
      this.client.get<any[]>('/interface/wireguard/peers'),
    ]);
    return {
      interfaces: interfaces.map(ToolsMapper.mapWireguardInterface),
      peers: peers.map(ToolsMapper.mapWireguardPeer),
    };
  }

  // ---------- Stockage ----------

  async getRouterFiles() {
    const raw = await this.client.get<any[]>('/file');
    return raw.map(StorageMapper.mapRouterFile);
  }

  /**
   * Écrit un fichier texte sur le routeur.
   *
   * **Sondé sur le hAP en 7.24.4, pas deviné** :
   *
   * - `PUT /rest/file` avec `name` et `contents` crée le fichier et rend 201 ;
   * - le contenu revient **octet pour octet**, et un `.pdf` est reconnu comme
   *   tel par le routeur ;
   * - au-delà de **61 440 octets**, RouterOS répond
   *   `failure: contents too long` ;
   * - `/tool/fetch`, qui aurait laissé le routeur télécharger le fichier
   *   lui-même, est refusé à ce compte d'API — `not enough permissions (9)`.
   *
   * Le contenu voyage dans du JSON : il doit donc être **ASCII**, sans quoi
   * l'encodage UTF-8 changerait les octets en route.
   */
  async writeRouterFile(name: string, contents: string): Promise<void> {
    if (contents.length > 61_440) {
      throw new MikrotikValidationError(
        `Fichier trop volumineux pour l'API du routeur : ${contents.length} octets, maximum 61 440`,
        { name, size: contents.length },
      );
    }
    // Contrôlé caractère par caractère plutôt que par une expression
    // régulière : la classe de caractères équivalente s'écrit avec des
    // échappements que le moindre outil de génération transforme en vrais
    // octets de contrôle dans le fichier source.
    const horsAscii = [...contents].find((c) => c.charCodeAt(0) > 127);
    if (horsAscii) {
      throw new MikrotikValidationError(
        `Le contenu doit être en ASCII : caractère « ${horsAscii} » refusé`,
        { name },
      );
    }
    await this.client.put<any>('/file', { name, contents });
  }

  /** Supprime un fichier du routeur, par son identifiant. */
  async deleteRouterFile(id: string): Promise<void> {
    await this.client.delete(`/file/${id}`);
  }

  async getRouterStorage() {
    const [resource, disks, packages, files] = await Promise.all([
      this.client.get<any>('/system/resource'),
      this.client.get<any[]>('/disk'),
      this.client.get<any[]>('/system/package'),
      this.client.get<any[]>('/file'),
    ]);
    return StorageMapper.mapRouterStorage(
      Array.isArray(resource) ? resource[0] : resource,
      disks,
      packages,
      files,
    );
  }

  /**
   * Allume ou éteint le service User Manager, et ses profils.
   *
   * `/user-manager` est un menu **singleton** : il n'a pas d'éléments, donc
   * pas d'identifiant à viser. RouterOS veut alors la commande `set` en POST
   * — `POST /rest/user-manager/set` — et non un PATCH sur le chemin.
   *
   * Éprouvé de la mauvaise façon d'abord : `PATCH /rest/user-manager` rend
   * **500 Internal Server Error** sur le hAP en 7.24.4. Relevé le
   * 2026-09-20, en cliquant le bouton de la console sur un vrai routeur.
   * C'est le PATCH des collections (`/user-manager/user/<id>`) qui avait
   * induit en erreur : la forme ne se transpose pas aux singletons.
   */
  async setUserManagerSettings(payload: { enabled?: boolean; useProfiles?: boolean }) {
    const corps: Record<string, string> = {};
    if (payload.enabled !== undefined) corps.enabled = payload.enabled ? 'yes' : 'no';
    if (payload.useProfiles !== undefined) {
      corps['use-profiles'] = payload.useProfiles ? 'yes' : 'no';
    }
    this.logger.info('Écriture des réglages User Manager', { corps });
    await this.client.post<any>('/user-manager/set', corps);
  }

  /**
   * Programme l'activation d'un paquet.
   *
   * Rien ne se produit avant le redémarrage : `disabled` reste vrai, et c'est
   * `scheduled` qui porte la trace de la demande. Le redémarrage n'est **pas**
   * déclenché ici — couper un routeur qui sert des centaines de clients est
   * une décision d'exploitant, pas un effet de bord.
   *
   * Même réserve que ci-dessus : forme non éprouvée sur le matériel.
   */
  async enablePackage(name: string) {
    const paquets = await this.client.get<any[]>('/system/package');
    const cible = paquets.find((p) => p?.name === name);
    if (!cible) throw new MikrotikNotFoundError('Paquet', name);

    this.logger.info('Programmation activation de paquet', { name });
    await this.client.post<any>('/system/package/enable', { '.id': cible['.id'] });
  }

  /**
   * Annule ce qui était programmé sur un paquet pour le prochain démarrage.
   *
   * Sert au cas le plus sournois : une désactivation programmée ne se voit
   * nulle part tant que le routeur tourne — `disabled` reste faux — et
   * emporte le service au premier redémarrage venu.
   */
  async unschedulePackage(name: string) {
    const paquets = await this.client.get<any[]>('/system/package');
    const cible = paquets.find((p) => p?.name === name);
    if (!cible) throw new MikrotikNotFoundError('Paquet', name);

    this.logger.info('Annulation de la programmation de paquet', { name });
    await this.client.post<any>('/system/package/unschedule', { '.id': cible['.id'] });
  }

  /**
   * Le diagnostic de User Manager.
   *
   * `/user-manager` et `/user-manager/database` repondent 500 quand le paquet
   * n'est pas installe : c'est justement le cas qu'on veut diagnostiquer, pas
   * une panne. On absorbe donc l'echec de ces deux lectures-la — et d'elles
   * seules. Un routeur injoignable doit continuer a lever.
   */
  async getUserManagerReadiness() {
    const [resource, disks, packages, files] = await Promise.all([
      this.client.get<any>('/system/resource'),
      this.client.get<any[]>('/disk'),
      this.client.get<any[]>('/system/package'),
      // Sert à repérer une base laissée derrière un déplacement : elle
      // ressemble à la vraie et prend la place qui manque.
      this.client.get<any[]>('/file'),
    ]);

    const absorber = async <T>(chemin: string): Promise<T | null> => {
      try {
        return await this.client.get<T>(chemin);
      } catch {
        return null;
      }
    };
    const [serviceRaw, databaseRaw] = await Promise.all([
      absorber<any>('/user-manager'),
      absorber<any>('/user-manager/database'),
    ]);

    return StorageMapper.evaluerUserManager({
      packagesRaw: packages,
      serviceRaw: Array.isArray(serviceRaw) ? serviceRaw[0] : serviceRaw,
      databaseRaw: Array.isArray(databaseRaw) ? databaseRaw[0] : databaseRaw,
      resource: Array.isArray(resource) ? resource[0] : resource,
      disksRaw: disks,
      filesRaw: files,
    });
  }

}
