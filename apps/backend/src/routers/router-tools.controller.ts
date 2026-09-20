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

  /** Serveurs DHCP declares. */
  @Get('dhcp-servers')
  async dhcpServers(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getDhcpServers();
  }

  /**
   * Regles de filtrage, dans leur ordre d'evaluation.
   *
   * L'ordre EST la logique : la premiere regle qui correspond decide. Le
   * mapper en fait un champ `position`, que RouterOS ne renvoie pas.
   */
  @Get('firewall/filter')
  async firewallFilter(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getFirewallFilterRules();
  }

  /** Regles de traduction d'adresses. C'est la que vit la redirection du portail. */
  @Get('firewall/nat')
  async firewallNat(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getFirewallNatRules();
  }

  @Get('dns')
  async dns(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getDnsSettings();
  }

  @Get('dns/static')
  async dnsStatic(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getDnsStaticEntries();
  }

  @Get('routes')
  async routes(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getRoutes();
  }

  // ---------- Stockage ----------

  /** Fichiers et dossiers, toutes racines confondues. */
  @Get('files')
  async files(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getRouterFiles();
  }

  /** Memoire interne, disques, paquets, et occupation par racine. */
  @Get('storage')
  async storage(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getRouterStorage();
  }

  /**
   * Le diagnostic de User Manager : installe, allume, et ou vivent ses
   * donnees.
   *
   * C'est la reponse a « pourquoi l'onglet User Manager n'apparait pas dans
   * WinBox » — et l'endroit ou l'on decouvre qu'une base posee sur une cle
   * USB depend d'une cle qui peut etre retiree.
   */
  @Get('user-manager-readiness')
  async userManagerReadiness(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getUserManagerReadiness();
  }
}
