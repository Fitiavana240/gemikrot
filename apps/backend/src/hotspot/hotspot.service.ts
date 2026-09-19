import { Injectable, NotFoundException } from '@nestjs/common';
import type { IMikrotikService } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import { parseRouterTime } from '../routers/router-time.util.js';
import { RouterAccessService } from '../routers/router-access.service.js';
import type {
  CreateWalledGardenDto,
  CreateWalledGardenIpDto,
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
