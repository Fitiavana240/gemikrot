import { Injectable, NotFoundException } from '@nestjs/common';
import type { IMikrotikService } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import { parseRouterTime } from '../routers/router-time.util.js';
import { RouterAccessService } from '../routers/router-access.service.js';
import type {
  CreateHotspotUserDto,
  CreateWalledGardenDto,
  CreateWalledGardenIpDto,
  UpdateHotspotUserDto,
} from './dto/hotspot.dto.js';

export interface SessionView {
  id: string;
  username: string;
  startedAt: string | null;
  endedAt: string | null;
  uptimeSeconds: number;
  bytesIn: number;
  bytesOut: number;
  callingStationId: string | null;
  terminateCause: string | null;
  active: boolean;
}

/**
 * Les onglets HotSpot et User Manager que la console ne montrait pas :
 * serveurs et leurs profils, Walled Garden, cookies, et l'historique des
 * sessions comptabilisées par RADIUS.
 *
 * Tout est lu depuis le routeur. L'application n'en garde aucune copie : ces
 * objets appartiennent à la configuration réseau, pas au suivi commercial.
 */
@Injectable()
export class HotspotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: MikrotikClientFactory,
    private readonly audit: AuditService,
    private readonly access: RouterAccessService,
  ) {}

  /**
   * Serveurs et profils, présentés ensemble : c'est le profil qui porte
   * `login-by` et la durée de vie des cookies, donc ce qui détermine si une
   * suspension coupe vraiment l'accès.
   */
  /**
   * Les comptes HotSpot du routeur.
   *
   * Distincts des comptes User Manager : le HotSpot en garde sa propre table,
   * et c'est elle que WinBox montre sous « Users ». Sur ce parc, les 646
   * comptes historiques vivent ici — les tickets vendus depuis sont passes a
   * User Manager, qui seul sait faire expirer une validite calendaire.
   */
  async users(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getHotspotUsers();
  }

  /** Les profils HotSpot : debit et duree de session, pas de validite. */
  async profiles(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getHotspotProfiles();
  }

  /**
   * Les hotes vus par le HotSpot, authentifies ou non.
   *
   * Un hote sans session est un appareil present sur le reseau qui n'a pas
   * ouvert d'acces : c'est la qu'on repere une TV ou une camera incapable
   * d'afficher un portail captif.
   */
  async hosts(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getHotspotHosts();
  }

  /** Les contournements du portail, par adresse MAC. */
  async ipBindings(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getIpBindings();
  }

  /** Les baux DHCP, pour rapprocher une adresse d'un nom d'appareil. */
  async dhcpLeases(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getDhcpLeases();
  }

  /**
   * Bloque ou reactive un compte HotSpot.
   *
   * Desactiver plutot que supprimer : le compte porte le trafic consomme et,
   * sur ce parc, le nom de la personne dans son commentaire. L'effacer perd
   * les deux.
   *
   * Attention toutefois : desactiver ne coupe pas une session en cours, et un
   * cookie encore valide rouvre l'acces sans repasser par le compte. Pour
   * couper vraiment, passer par `cut-access`, qui purge aussi cookies et
   * session.
   */
  /**
   * Cree un compte HotSpot.
   *
   * A distinguer d'un ticket User Manager : ici la validite n'est pas
   * calendaire. `limitUptimeSeconds` plafonne le temps **passe connecte** et
   * ne s'ecoule pas quand le client se deconnecte — c'est ce que porte le
   * ticket « 2h » du parc, et c'est l'inverse d'un forfait au mois.
   */
  async createUser(dto: CreateHotspotUserDto, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    const compte = await mikrotik.createHotspotUser(dto);
    await this.audit.log({
      adminUserId,
      routerId,
      action: 'CREATE_HOTSPOT_USER',
      targetType: 'HotspotUser',
      targetId: dto.username,
      payloadDiff: {
        profile: dto.profileName,
        server: dto.server ?? null,
        limitUptimeSeconds: dto.limitUptimeSeconds ?? null,
      },
    });
    return compte;
  }

  /** N'ecrit que les champs fournis. Le mot de passe ne va pas au journal. */
  async updateUser(
    username: string,
    dto: Omit<UpdateHotspotUserDto, 'username'>,
    adminUserId?: string,
    routerId?: string,
  ) {
    const mikrotik = await this.client(routerId);
    const compte = await mikrotik.updateHotspotUser({ ...dto, username });
    await this.audit.log({
      adminUserId,
      routerId,
      action: 'UPDATE_HOTSPOT_USER',
      targetType: 'HotspotUser',
      targetId: username,
      payloadDiff: { champs: Object.keys(dto) },
    });
    return compte;
  }

  /**
   * Bloquer suppose trois gestes, pas un.
   *
   * Désactiver le compte ne ferme pas la session en cours, et le profil
   * serveur de ce parc accepte `mac-cookie` avec une durée de vie de **trois
   * jours** : le client se reconnecte sans que le compte désactivé soit
   * consulté. L'écran le disait déjà — mais sur l'onglet Cookies, loin du
   * bouton qui échouait, et derrière une action séparée « Couper l'accès »
   * qu'il fallait penser à aller chercher. **Documenter un piège n'est pas la
   * même chose que ne pas en avoir.**
   */
  async setUserDisabled(
    username: string,
    disabled: boolean,
    adminUserId?: string,
    routerId?: string,
  ) {
    const mikrotik = await this.client(routerId);
    const compte = await mikrotik.setHotspotUserDisabled(username, disabled);
    // `disableAccount: false` : le compte HotSpot vient d'être désactivé
    // ci-dessus ; `revoke` désactiverait un compte *User Manager*, qui est
    // autre chose.
    const coupure = disabled
      ? await this.access.revoke(mikrotik, username, { disableAccount: false })
      : null;
    await this.audit.log({
      adminUserId,
      routerId,
      action: disabled ? 'DISABLE_HOTSPOT_USER' : 'ENABLE_HOTSPOT_USER',
      targetType: 'HotspotUser',
      targetId: username,
      payloadDiff: coupure ? { ...coupure } : undefined,
    });
    return { ...compte, coupure };
  }

  /**
   * Supprime un compte HotSpot du routeur.
   *
   * Irreversible, et le trafic consomme comme le commentaire disparaissent
   * avec. Le blocage est presque toujours le bon geste ; la suppression sert
   * a nettoyer un compte cree par erreur.
   */
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
  async deleteUser(username: string, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    await this.access.revoke(mikrotik, username, { disableAccount: false });
    await mikrotik.deleteHotspotUser(username);
    await this.audit.log({
      adminUserId,
      routerId,
      action: 'DELETE_HOTSPOT_USER',
      targetType: 'HotspotUser',
      targetId: username,
    });
  }

  /** Profils de serveur : c'est la que vit `login-by` et la duree des cookies. */
  async serverProfiles(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getHotspotServerProfiles();
  }

  /** Protocoles dont le HotSpot suit les connexions (`ftp`, `sip`...). */
  async servicePorts(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getHotspotServicePorts();
  }

  async overview(routerId?: string) {
    const mikrotik = await this.client(routerId);
    const [servers, profiles, cookies, active] = await Promise.all([
      mikrotik.getHotspotServers(),
      mikrotik.getHotspotServerProfiles(),
      mikrotik.getHotspotCookies(),
      mikrotik.getHotspotActiveUsers(),
    ]);

    const profileByName = new Map(profiles.map((profile) => [profile.name, profile]));
    return {
      servers: servers.map((server) => ({
        ...server,
        profile: server.profileName ? (profileByName.get(server.profileName) ?? null) : null,
      })),
      profiles,
      cookieCount: cookies.length,
      activeSessionCount: active.length,
      /**
       * Nombre de sessions entrées sans passer par RADIUS. Ce sont celles
       * qu'une suspension côté User Manager n'aurait pas coupées.
       */
      sessionsWithoutRadius: active.filter((session) => session.loginBy.includes('cookie')).length,
    };
  }

  // ---------- Walled Garden ----------

  async getWalledGarden(routerId?: string) {
    const mikrotik = await this.client(routerId);
    const [hosts, ips] = await Promise.all([
      mikrotik.getWalledGarden(),
      mikrotik.getWalledGardenIps(),
    ]);
    return { hosts, ips };
  }

  async addWalledGardenHost(dto: CreateWalledGardenDto, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    const entry = await mikrotik.createWalledGardenEntry(dto);
    await this.log(adminUserId, 'CREATE_WALLED_GARDEN', entry.id, { dstHost: dto.dstHost });
    return entry;
  }

  async removeWalledGardenHost(id: string, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    await mikrotik.deleteWalledGardenEntry(id);
    await this.log(adminUserId, 'DELETE_WALLED_GARDEN', id);
  }

  async addWalledGardenIp(dto: CreateWalledGardenIpDto, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    const entry = await mikrotik.createWalledGardenIpEntry(dto);
    await this.log(adminUserId, 'CREATE_WALLED_GARDEN_IP', entry.id, {
      dstAddress: dto.dstAddress,
    });
    return entry;
  }

  async removeWalledGardenIp(id: string, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    await mikrotik.deleteWalledGardenIpEntry(id);
    await this.log(adminUserId, 'DELETE_WALLED_GARDEN_IP', id);
  }

  // ---------- Cookies ----------

  /**
   * Les cookies de connexion, avec le temps qu'il leur reste. Un cookie
   * vivant rouvre une session sans repasser par RADIUS : c'est ce qui laisse
   * un accès coupé fonctionner encore, parfois plusieurs jours.
   */
  async getCookies(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getHotspotCookies();
  }

  async deleteCookie(id: string, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    await mikrotik.deleteHotspotCookie(id);
    await this.log(adminUserId, 'DELETE_HOTSPOT_COOKIE', id);
  }

  /** Purge les cookies d'un compte et ferme sa session : coupure immédiate. */
  async cutAccess(username: string, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    const result = await this.access.revoke(mikrotik, username, { disableAccount: false });
    await this.log(adminUserId, 'CUT_HOTSPOT_ACCESS', username, { ...result });
    return result;
  }

  // ---------- Sessions User Manager ----------

  /**
   * Historique comptabilisé par RADIUS : qui s'est connecté, combien de
   * temps, combien de données. C'est la seule source qui dit ce qu'un compte
   * a réellement consommé.
   */
  async getSessions(username?: string, routerId?: string): Promise<SessionView[]> {
    const mikrotik = await this.client(routerId);
    const [sessions, clock] = await Promise.all([
      mikrotik.getUserManagerSessions(username),
      mikrotik.getClock(),
    ]);

    return sessions
      .map((session) => ({
        id: session.id,
        username: session.username,
        startedAt: parseRouterTime(session.startTime, clock.gmtOffset)?.toISOString() ?? null,
        endedAt: parseRouterTime(session.stopTime, clock.gmtOffset)?.toISOString() ?? null,
        uptimeSeconds: session.sessionTimeSeconds,
        bytesIn: session.bytesIn,
        bytesOut: session.bytesOut,
        callingStationId: session.callingStationId,
        terminateCause: session.terminateCause,
        // L'état vient du routeur : une session close dont la date de fin
        // manque ne doit pas passer pour encore en cours.
        active: session.active,
      }))
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  }

  /** Le routeur est résolu par le client cloisonné, jamais par l'URL seule. */
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
      targetType: 'Hotspot',
      targetId,
      payloadDiff: payloadDiff as never,
    });
  }
}
