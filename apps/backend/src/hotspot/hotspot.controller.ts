import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { HotspotService } from './hotspot.service.js';
import { CreateWalledGardenDto, CreateWalledGardenIpDto } from './dto/hotspot.dto.js';

/** Le Walled Garden ouvre une brèche avant authentification : exploitant seul. */
const CAN_CONFIGURE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN];
/** Couper un accès est un geste quotidien de vendeur. */
const CAN_OPERATE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.OPERATOR];

@Controller('hotspot')
export class HotspotController {
  constructor(private readonly hotspot: HotspotService) {}

  @Get('overview')
  overview(@Query('routerId') routerId?: string) {
    return this.hotspot.overview(routerId);
  }

  /** Les comptes de la table HotSpot, distincts de ceux de User Manager. */
  @Get('users')
  users(@Query('routerId') routerId?: string) {
    return this.hotspot.users(routerId);
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
