import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { Roles } from '../auth/roles.decorator.js';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';
import { RouterRepairService } from './router-repair.service.js';

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
 *
 * **Une exception au « lecture seule »** : les réparations de la préparation
 * de User Manager (`POST repairs/:code`). Elles ne sont pas des réglages
 * d'infrastructure mais la mise en service du produit lui-même, et sans elles
 * il faudrait WinBox pour démarrer. Elles passent par une liste blanche
 * nommée — aucune commande RouterOS ne transite par cette route.
 */
const CAN_READ = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN];

@Roles(...CAN_READ)
@Controller('routers/:routerId/tools')
export class RouterToolsController {
  constructor(
    private readonly clients: MikrotikClientFactory,
    private readonly repair: RouterRepairService,
  ) {}

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

  /**
   * Les radios du routeur, et les clients qui y sont associés.
   *
   * Les deux ensemble : une radio sans client et un client sans radio ne se
   * lisent pas de la même façon, et l'exploitant a besoin des deux pour
   * savoir si le Wi-Fi vient d'ici ou d'ailleurs.
   */
  @Get('wireless')
  async wireless(@Param('routerId') routerId: string) {
    const mikrotik = await this.clients.forRouter(routerId);
    const [radios, clients] = await Promise.all([
      mikrotik.getWirelessInterfaces(),
      mikrotik.getWirelessClients(),
    ]);
    return { radios, clients };
  }

  /**
   * Le tunnel côté routeur, et par quelle adresse la console l'a joint.
   *
   * Les deux ensemble, parce que la question de l'exploitant est une seule :
   * « est-ce que ça passe par le VPN ? »
   */
  @Get('wireguard')
  async wireguard(@Param('routerId') routerId: string) {
    const [mikrotik, chemin] = await Promise.all([
      this.clients.forRouter(routerId),
      this.clients.cheminVers(routerId),
    ]);
    // Renommé à la frontière HTTP : le français reste à l'intérieur, le fil
    // porte de l'ASCII — c'est ce que fait déjà le reste des contrats de cette
    // application, et un accent dans une clé JSON traverse trop d'outils.
    return {
      ...(await mikrotik.getWireguard()),
      chemin: { adresse: chemin.hôte, parLeTunnel: chemin.parLeTunnel },
    };
  }

  /** La structure du réseau : adresses, pont, ports, bail montant. */
  @Get('structure')
  async structure(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getStructureReseau();
  }

  /** Les ports cuivre : débit, duplex négocié, collisions. */
  @Get('ethernet')
  async ethernet(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getPortsEthernet();
  }

  /** Les certificats du routeur, dont celui qui sert l'API. */
  @Get('certificates')
  async certificates(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getCertificates();
  }

  /** Scripts et ordonnanceur : ce qui peut s'exécuter sans personne. */
  @Get('automatisations')
  async automatisations(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getAutomatisations();
  }

  /** Le client RADIUS : ce qui relie le HotSpot à User Manager. */
  @Get('radius')
  async radius(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getRadiusClients();
  }

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

  /** Ce que la console sait reparer elle-meme. Liste fixe, cote serveur. */
  @Get('repairs')
  repairs() {
    return this.repair.listerRéparations();
  }

  /**
   * Applique une reparation nommee.
   *
   * **Liste blanche, et non passe-plat.** Le code recu selectionne une entree
   * fixe ; aucune commande RouterOS ne transite par cette route. Reserve au
   * SUPER_ADMIN et a l'ADMIN comme le reste du controleur, et journalise a
   * l'audit avec son resultat reel — le service relit l'etat du routeur
   * plutot que de croire l'absence d'erreur.
   */
  @Post('repairs/:code')
  applyRepair(
    @Param('routerId') routerId: string,
    @Param('code') code: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.repair.appliquer(routerId, code, user.id);
  }
}
