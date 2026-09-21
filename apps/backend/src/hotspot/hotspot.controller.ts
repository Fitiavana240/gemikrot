import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
  CreateHotspotUserDto,
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
  @Get('page-connexion')
  apercuPageConnexion(@Query() q: Record<string, string>) {
    // Les reglages en cours de saisie priment sur ceux enregistres : c'est ce
    // qui rend l'apercu vivant pendant qu'on tape, sans rien ecrire en base.
    return this.pageConnexion.apercu(q as never);
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
  ) {
    return this.pageConnexion.etat(routerId, portailUrl);
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
  @Get('page-connexion/fichier')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async fichierPageConnexion(
    @Res({ passthrough: true }) res: Response,
    @Query('portailUrl') portailUrl?: string,
  ) {
    res.setHeader('Content-Disposition', 'attachment; filename="login.html"');
    const { contenu } = await this.pageConnexion.apercu(
      portailUrl ? ({ portailUrl } as never) : undefined,
    );
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
