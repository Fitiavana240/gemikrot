import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { UserManagerService } from './user-manager.service.js';
import {
  AssignProfileDto,
  AttachLimitationDto,
  CreateAccountDto,
  CreateLimitationDto,
  CreateUserManagerProfileDto,
  SetAccountDisabledDto,
  UpdateAccountDto,
  UpdateLimitationDto,
  UpdateUserManagerProfileDto,
} from './dto/user-manager.dto.js';

/** Un profil ou une limitation engage la tarification : réservé à l'exploitant. */
const CAN_CONFIGURE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN];
/** Un compte se crée et se suspend au quotidien : l'opérateur en a besoin. */
const CAN_OPERATE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.OPERATOR];

@Controller('user-manager')
export class UserManagerController {
  constructor(private readonly userManager: UserManagerService) {}

  // ---------- Profils ----------

  /** Historique des authentifications RADIUS. Filtrable par compte. */
  /** Clients RADIUS declares. Le secret partage n'est jamais rendu. */
  @Get('routers')
  routers(@Query('routerId') routerId?: string) {
    return this.userManager.routers(routerId);
  }

  /** Groupes d'authentification. */
  @Get('user-groups')
  userGroups(@Query('routerId') routerId?: string) {
    return this.userManager.userGroups(routerId);
  }

  /** Attributs RADIUS connus du routeur. */
  @Get('attributes')
  attributes(@Query('routerId') routerId?: string) {
    return this.userManager.attributes(routerId);
  }

  @Get('sessions')
  sessions(@Query('username') username?: string, @Query('routerId') routerId?: string) {
    return this.userManager.sessions(username, routerId);
  }

  /** Attributions profil/compte : c'est la que vit l'echeance reelle. */
  @Get('assignments')
  assignments(@Query('username') username?: string, @Query('routerId') routerId?: string) {
    return this.userManager.assignments(username, routerId);
  }

  @Get('profiles')
  listProfiles(@Query('routerId') routerId?: string) {
    return this.userManager.listProfiles(routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Post('profiles')
  createProfile(
    @Body() dto: CreateUserManagerProfileDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.createProfile(dto, user.id, routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Patch('profiles/:name')
  updateProfile(
    @Param('name') name: string,
    @Body() dto: UpdateUserManagerProfileDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.updateProfile(name, dto, user.id, routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Delete('profiles/:name')
  deleteProfile(
    @Param('name') name: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.deleteProfile(name, user.id, routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Post('profiles/:name/limitations')
  attachLimitation(
    @Param('name') name: string,
    @Body() dto: AttachLimitationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.attachLimitation(name, dto, user.id, routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Delete('profiles/:name/limitations/:limitationName')
  detachLimitation(
    @Param('name') name: string,
    @Param('limitationName') limitationName: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.detachLimitation(name, limitationName, user.id, routerId);
  }

  // ---------- Limitations ----------

  @Get('limitations')
  listLimitations(@Query('routerId') routerId?: string) {
    return this.userManager.listLimitations(routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Post('limitations')
  createLimitation(
    @Body() dto: CreateLimitationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.createLimitation(dto, user.id, routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Patch('limitations/:name')
  updateLimitation(
    @Param('name') name: string,
    @Body() dto: UpdateLimitationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.updateLimitation(name, dto, user.id, routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Delete('limitations/:name')
  deleteLimitation(
    @Param('name') name: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.deleteLimitation(name, user.id, routerId);
  }

  // ---------- Comptes ----------

  @Get('users')
  listAccounts(@Query('routerId') routerId?: string) {
    return this.userManager.listAccounts(routerId);
  }

  @Roles(...CAN_OPERATE)
  @Post('users')
  createAccount(
    @Body() dto: CreateAccountDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.createAccount(dto, user.id, routerId);
  }

  @Roles(...CAN_OPERATE)
  @Patch('users/:username')
  updateAccount(
    @Param('username') username: string,
    @Body() dto: UpdateAccountDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.updateAccount(username, dto, user.id, routerId);
  }

  @Roles(...CAN_OPERATE)
  @Patch('users/:username/disabled')
  setDisabled(
    @Param('username') username: string,
    @Body() dto: SetAccountDisabledDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.setAccountDisabled(username, dto.disabled, user.id, routerId);
  }

  @Roles(...CAN_CONFIGURE)
  @Delete('users/:username')
  deleteAccount(
    @Param('username') username: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.deleteAccount(username, user.id, routerId);
  }

  @Roles(...CAN_OPERATE)
  @Post('users/:username/profiles')
  assignProfile(
    @Param('username') username: string,
    @Body() dto: AssignProfileDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.assignProfile(username, dto, user.id, routerId);
  }

  @Roles(...CAN_OPERATE)
  @Delete('users/:username/profiles/:profileName')
  removeProfile(
    @Param('username') username: string,
    @Param('profileName') profileName: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.userManager.removeProfile(username, profileName, user.id, routerId);
  }
}
