import { Controller, Get, Param, Post } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';

/**
 * Lecture directe de l'état d'un routeur (Section 26/27 : "clients connectés",
 * "voir les sessions"). Données live, sans cache Postgres — l'agrégation
 * historique reste dans DashboardController.
 */
@Controller('routers/:routerId')
export class RouterMonitoringController {
  constructor(private readonly clients: MikrotikClientFactory) {}

  /**
   * L'etat du routeur en un appel : qui il est, ce qu'il fait tourner, et
   * quelle heure il est chez lui.
   *
   * L'horloge est ici parce que c'est elle qui decide des expirations. Une
   * console dont la pendule avance de dix minutes sur celle du routeur
   * annonce des coupures qui n'ont pas eu lieu, et l'ecart ne se voit nulle
   * part tant que personne ne montre les deux.
   */
  @Get('status')
  async status(@Param('routerId') routerId: string) {
    const mikrotik = await this.clients.forRouter(routerId);
    const [identity, resource, ntp, clock] = await Promise.all([
      mikrotik.getRouterIdentity(),
      mikrotik.getSystemResource(),
      mikrotik.getNtpStatus(),
      mikrotik.getClock(),
    ]);
    return { identity, resource, ntp, clock };
  }

  /** Un utilisateur HotSpot actif = un appareil connecté avec un ticket actif. */
  @Get('active-sessions')
  async activeSessions(@Param('routerId') routerId: string) {
    const mikrotik = await this.clients.forRouter(routerId);
    return mikrotik.getHotspotActiveUsers();
  }

  /** Tous les appareils vus par le HotSpot, authentifiés ou non. */
  @Get('hosts')
  async hosts(@Param('routerId') routerId: string) {
    const mikrotik = await this.clients.forRouter(routerId);
    return mikrotik.getHotspotHosts();
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.OPERATOR)
  @Post('active-sessions/:sessionId/disconnect')
  async disconnect(
    @Param('routerId') routerId: string,
    @Param('sessionId') sessionId: string,
  ) {
    const mikrotik = await this.clients.forRouter(routerId);
    return mikrotik.disconnectHotspotUser({ sessionId });
  }
}
