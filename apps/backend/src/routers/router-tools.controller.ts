import { Controller, Get, Param, Query } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';

/**
 * Les tables de diagnostic et de débit du routeur.
 *
 * **Lecture seule, par décision.** Modifier une file ou un service depuis la
 * console suppose de comprendre ce qu'on casse sur un routeur qui sert des
 * centaines de clients ; la console montre, WinBox modifie.
 *
 * Réservé aux rôles d'administration : ce sont des réglages d'infrastructure,
 * pas des gestes de vente. Un vendeur n'a rien à y faire, et le journal du
 * routeur expose des adresses et des noms de comptes.
 */
const CAN_READ = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN];

@Roles(...CAN_READ)
@Controller('routers/:routerId/tools')
export class RouterToolsController {
  constructor(private readonly clients: MikrotikClientFactory) {}

  /** Files simples : le débit réellement alloué, client par client. */
  @Get('queues')
  async queues(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getSimpleQueues();
  }

  /** Journal du routeur. Borné : il en garde un millier de lignes. */
  @Get('log')
  async log(@Param('routerId') routerId: string, @Query('limit') limit?: string) {
    const borne = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    return (await this.clients.forRouter(routerId)).getRouterLog(borne);
  }

  /** Interfaces : trafic, erreurs, et surtout coupures de lien. */
  @Get('interfaces')
  async interfaces(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getInterfaceStats();
  }

  /** Services d'administration et adresses autorisées à les joindre. */
  @Get('services')
  async services(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getIpServices();
  }

  /** DDNS de MikroTik : une alternative au tunnel pour l'accès distant. */
  @Get('cloud')
  async cloud(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getIpCloud();
  }

  /** Table ARP : quelle adresse répond sur quel matériel. */
  @Get('arp')
  async arp(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getArpEntries();
  }

  /** Serveurs DHCP déclarés. */
  @Get('dhcp-servers')
  async dhcpServers(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getDhcpServers();
  }
}
