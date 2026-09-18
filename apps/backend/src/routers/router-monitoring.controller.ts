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

  @Get('status')
  async status(@Param('routerId') routerId: string) {
    const mikrotik = await this.clients.forRouter(routerId);
    const [identity, resource, ntp] = await Promise.all([
      mikrotik.getRouterIdentity(),
      mikrotik.getSystemResource(),
      mikrotik.getNtpStatus(),
    ]);
    return { identity, resource, ntp };
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
