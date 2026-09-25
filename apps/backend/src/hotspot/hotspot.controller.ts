import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { HotspotService } from './hotspot.service.js';
import { PageConnexionService } from './page-connexion.service.js';
import {
  ChangerTypeContournementDto,
  CreateHotspotUserDto,
  CreateIpBindingDto,
  CreateWalledGardenDto,
  CreateWalledGardenIpDto,
  UpdateHotspotProfileDto,
  UpdateHotspotUserDto,
} from './dto/hotspot.dto.js';

/** Le Walled Garden ouvre une brèche avant authentification : exploitant seul. */
const CAN_CONFIGURE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN];
/** Couper un accès est un geste quotidien de vendeur. */
const CAN_OPERATE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.OPERATOR];

@Controller('hotspot')
export class HotspotController {
  constructor(
    private readonly hotspot: HotspotService,
    private readonly pageConnexion: PageConnexionService,
  ) {}

  /**
   * PUB-7 : la page du portail captif, remplie mais pas envoyee.
   *
   * Previsualiser avant d'ecraser n'est pas un luxe : une page fautive sur
   * le routeur, et plus personne ne se connecte -- ni les clients deja
   * payants, ni ceux qui viennent d'acheter.
   */
  /**
   * L'apercu, reglages en cours de saisie compris.
   *
   * En POST alors qu'il ne change rien, et c'est deliberе : un logo embarque
   * pese une dizaine de milliers de caracteres, et une URL de cette longueur
   * se fait refuser par Node avant meme d'atteindre le controleur -- releve,
   * HTTP 431. Le corps de requete n'a pas cette limite.
   */
  @Post('page-connexion/apercu')
  @HttpCode(200)
  apercuPageConnexion(@Body() body: Record<string, unknown>) {
    return this.pageConnexion.apercu(body as never);
  }

  /**
   * Les reglages de l'exploitant, et l'etat de publication sur son routeur.
   *
   * Le chemin etait en dur (`flash/hotspot/login.html`). Il se trouve juste
   * sur ce parc, et faux des qu'un serveur HotSpot utilise le profil
   * `default`, qui sert depuis `hotspot` : la console ecrivait alors un
   * fichier que personne ne sert, en annoncant un succes.
   */
  @Get('page-connexion/etat')
  etatPageConnexion(
    @Query('routerId') routerId?: string,
    @Query('portailUrl') portailUrl?: string,
    // Le port par lequel la console est consultee en ce moment meme. Le
    // serveur ne le connait pas : en developpement le navigateur parle a Vite
    // sur 5173, qui relaie vers l'API sur 3000. C'est donc au navigateur de
    // le dire, et c'est la seule facon de proposer une adresse qui marche.
    @Query('portConsole') portConsole?: string,
  ) {
    return this.pageConnexion.etat(routerId, portailUrl, portConsole);
  }

  /**
   * Le fichier, a poser soi-meme dans le routeur.
   *
   * L'API sait l'ecrire, et c'est le chemin court. Mais elle suppose que la
   * console **atteigne** le routeur : tant qu'il n'y a ni tunnel ni adresse
   * publique, la plupart des exploitants ne seront joignables que depuis leur
   * propre reseau. Le telechargement marche dans tous les cas, et il a un
   * second merite : l'exploitant voit ce qu'il installe avant de l'installer.
   *
   * En piece jointe, jamais affiche : un HTML rendu dans l'onglet donnerait
   * une page qui ressemble a la vraie et qu'on ne peut pas enregistrer.
   */
  @Post('page-connexion/fichier')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async fichierPageConnexion(
    @Res({ passthrough: true }) res: Response,
    @Body() body: Record<string, unknown>,
  ) {
    res.setHeader('Content-Disposition', 'attachment; filename="login.html"');
    const { contenu } = await this.pageConnexion.apercu(body as never);
    return contenu;
  }

  /** Enregistre les reglages. Rien n'est envoye au routeur ici. */
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Patch('page-connexion')
  enregistrerPageConnexion(
    @Body() body: Record<string, string>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pageConnexion.enregistrer(body as never, user.id);
  }

  /**
   * Remet d'accord l'adresse de la console, le Walled Garden et la page.
   *
   * Un seul geste, parce qu'il n'y a aucun cas ou l'on veut n'en faire que
   * deux sur trois : une page republiee vers une adresse non autorisee est
   * aussi morte qu'une page non republiee.
   */
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  /**
   * Le script a coller, quand l'ecriture par l'API ne passe pas.
   *
   * `publier` reste le chemin normal. Celui-ci ne depend ni du tunnel, ni des
   * droits du compte applicatif : c'est le routeur qui agit.
   */
  @Get('page-connexion/script')
  scriptPageConnexion(@Query('routerId') routerId?: string) {
    return this.pageConnexion.script(routerId);
  }

  @Post('page-connexion/reparer')
  reparerPageConnexion(
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.pageConnexion.reparer(user.id, routerId);
  }

  /** Ecrit la page sur chaque dossier reellement servi par le routeur. */
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Post('page-connexion')
  publierPageConnexion(
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.pageConnexion.publier(user.id, routerId);
  }

  @Get('overview')
  overview(@Query('routerId') routerId?: string) {
    return this.hotspot.overview(routerId);
  }

  /** Les comptes de la table HotSpot, distincts de ceux de User Manager. */
  @Get('users')
  users(@Query('routerId') routerId?: string) {
    return this.hotspot.users(routerId);
  }

  /** Modifie un profil HotSpot : débit, durées, appareils, cookie. */
  @Patch('profiles/:name')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  updateProfile(
    @Param('name') name: string,
    @Body() dto: UpdateHotspotProfileDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.updateProfile(name, dto, user.id, routerId);
  }

  /** Combien de tickets dorment réellement sur le routeur, par profil. */
  /**
   * Les comptes vendables sans plafond de durée, et de quoi le poser.
   *
   * `apply=true` écrit sur le routeur ; sans lui, rien n'est touché et la
   * réponse dit seulement ce qui changerait. Le défaut est l'aperçu : poser un
   * plafond sur des comptes en vente se regarde avant de se faire.
   */
  @Roles(...CAN_CONFIGURE)
  @Post('plafonds')
  plafonds(@Query('routerId') routerId?: string, @Query('apply') apply?: string) {
    return this.hotspot.plafonds(routerId, { appliquer: apply === 'true' });
  }

  @Get('stock')
  stock(@Query('routerId') routerId?: string) {
    return this.hotspot.stock(routerId);
  }

  /** Profils HotSpot : debit et duree de session. */
  @Get('profiles')
  profiles(@Query('routerId') routerId?: string) {
    return this.hotspot.profiles(routerId);
  }

  /** Hotes vus sur le reseau, authentifies ou non. */
  @Get('hosts')
  hosts(@Query('routerId') routerId?: string) {
    return this.hotspot.hosts(routerId);
  }

  /** Contournements du portail captif, par adresse MAC. */
  @Get('ip-bindings')
  ipBindings(@Query('routerId') routerId?: string) {
    return this.hotspot.ipBindings(routerId);
  }

  /**
   * Faire passer un appareil sans ticket, et lui poser une limite.
   *
   * **Écrit sur le routeur.** Les deux gestes au même endroit : un appareil
   * contourné n'a pas de profil, donc pas de limite — sans file d'attente il
   * prend toute la ligne, et c'est l'appareil dont on le remarque le moins.
   */
  @Roles(...CAN_CONFIGURE)
  @Post('ip-bindings')
  creerContournement(
    @Body() dto: CreateIpBindingDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.creerContournement(dto, user.id, routerId);
  }

  /** Passer un appareil de `regular` à `bypassed`, ou l'inverse. */
  @Roles(...CAN_CONFIGURE)
  @Patch('ip-bindings/:id')
  changerTypeContournement(
    @Param('id') id: string,
    @Body() dto: ChangerTypeContournementDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.changerTypeContournement(id, dto.type, user.id, routerId);
  }

  /** Retire le contournement **et** la file d'attente qui l'accompagnait. */
  @Roles(...CAN_CONFIGURE)
  @Delete('ip-bindings/:id')
  supprimerContournement(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.supprimerContournement(id, user.id, routerId);
  }

  /** Baux DHCP, pour rapprocher une adresse d'un nom d'appareil. */
  @Get('dhcp-leases')
  dhcpLeases(@Query('routerId') routerId?: string) {
    return this.hotspot.dhcpLeases(routerId);
  }

  /**
   * Cree un compte HotSpot.
   *
   * La console vend d'abord des tickets User Manager, dont la validite est
   * calendaire. Celle-ci sert l'autre cas : un acces plafonne en **temps de
   * connexion**, qui ne s'ecoule pas pendant que le client est deconnecte —
   * les tickets « 2h » que porte deja la majorite du parc.
   */
  @Roles(...CAN_CONFIGURE)
  @Post('users')
  createUser(
    @Body() dto: CreateHotspotUserDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.createUser(dto, user.id, routerId);
  }

  /** N'ecrit que les champs fournis. Le nom identifie le compte. */
  @Roles(...CAN_CONFIGURE)
  @Patch('users/:username')
  updateUser(
    @Param('username') username: string,
    @Body() dto: UpdateHotspotUserDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.updateUser(username, dto, user.id, routerId);
  }

  /** Bloquer ou reactiver, sans perdre le trafic ni le commentaire. */
  @Roles(...CAN_CONFIGURE)
  @Patch('users/:username/disabled')
  setUserDisabled(
    @Param('username') username: string,
    @Body('disabled') disabled: boolean,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.setUserDisabled(username, disabled, user.id, routerId);
  }

  /** Suppression definitive : le trafic consomme part avec le compte. */
  @Roles(...CAN_CONFIGURE)
  @Delete('users/:username')
  deleteUser(
    @Param('username') username: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.deleteUser(username, user.id, routerId);
  }

  /** Profils de serveur : `login-by` et duree de vie des cookies. */
  @Get('server-profiles')
  serverProfiles(@Query('routerId') routerId?: string) {
    return this.hotspot.serverProfiles(routerId);
  }

  /** Ports applicatifs suivis par le HotSpot. */
  @Get('service-ports')
  servicePorts(@Query('routerId') routerId?: string) {
    return this.hotspot.servicePorts(routerId);
  }

  @Get('walled-garden')
  walledGarden(@Query('routerId') routerId?: string) {
    return this.hotspot.getWalledGarden(routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Post('walled-garden')
  addHost(
    @Body() dto: CreateWalledGardenDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.addWalledGardenHost(dto, user.id, routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Delete('walled-garden/:id')
  removeHost(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.removeWalledGardenHost(id, user.id, routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Post('walled-garden/ip')
  addIp(
    @Body() dto: CreateWalledGardenIpDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.addWalledGardenIp(dto, user.id, routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Delete('walled-garden/ip/:id')
  removeIp(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.removeWalledGardenIp(id, user.id, routerId);
  }

  @Get('cookies')
  cookies(@Query('routerId') routerId?: string) {
    return this.hotspot.getCookies(routerId);
  }

  @Roles(...CAN_OPERATE)
  @Delete('cookies/:id')
  deleteCookie(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.deleteCookie(id, user.id, routerId);
  }

  /** Purge les cookies d'un compte et ferme sa session. */
  @Roles(...CAN_OPERATE)
  @Post('cut-access/:username')
  cutAccess(
    @Param('username') username: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.hotspot.cutAccess(username, user.id, routerId);
  }

  @Get('sessions')
  sessions(@Query('username') username?: string, @Query('routerId') routerId?: string) {
    return this.hotspot.getSessions(username, routerId);
  }
}
