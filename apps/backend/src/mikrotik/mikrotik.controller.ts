import { Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import type { IMikrotikService } from '@wifitati/mikrotik-service';
import { Roles } from '../auth/roles.decorator.js';
import { MIKROTIK_SERVICE } from './mikrotik.constants.js';

/**
 * Lecture directe de l'état RouterOS (Section 26/27 : "clients connectés",
 * "voir les sessions"). Données live, pas de cache Postgres ici — pour
 * l'historique/agrégation, voir DashboardController.
 */
@Controller('mikrotik')
export class MikrotikController {
  constructor(@Inject(MIKROTIK_SERVICE) private readonly mikrotik: IMikrotikService) {}

  @Get('status')
  async status() {
    const [identity, resource, ntp] = await Promise.all([
      this.mikrotik.getRouterIdentity(),
      this.mikrotik.getSystemResource(),
      this.mikrotik.getNtpStatus(),
    ]);
    return { identity, resource, ntp };
  }

  /** Un utilisateur HotSpot actif = un appareil connecté avec un ticket actif. */
  @Get('active-sessions')
  activeSessions() {
    return this.mikrotik.getHotspotActiveUsers();
  }

  /** Tous les appareils vus par le HotSpot, authentifiés ou non. */
  @Get('hosts')
  hosts() {
    return this.mikrotik.getHotspotHosts();
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.OPERATOR)
  @Post('active-sessions/:id/disconnect')
  disconnect(@Param('id') id: string) {
    return this.mikrotik.disconnectHotspotUser({ sessionId: id });
  }
}
