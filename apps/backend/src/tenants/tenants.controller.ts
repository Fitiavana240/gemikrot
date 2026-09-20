import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AdminRole, TenantStatus } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { TenantsService } from './tenants.service.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import { MobileMoneyAccountDto } from './dto/mobile-money-account.dto.js';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /** Paramètres de l'exploitant connecté (marque, devise, puces Mobile Money). */
  @Get('me')
  findMine() {
    return this.tenants.findMine();
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Patch('me')
  updateMine(@Body() dto: UpdateTenantDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.update(dto, user.id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Post('me/mobile-money')
  addMobileMoney(@Body() dto: MobileMoneyAccountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.addMobileMoneyAccount(dto, user.id);
  }

  /** Retirer une puce du choix propose au client, sans effacer son historique. */
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Patch('me/mobile-money/:id/active')
  setMobileMoneyActive(
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenants.setMobileMoneyActive(id, body.isActive, user.id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Delete('me/mobile-money/:id')
  removeMobileMoney(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.removeMobileMoneyAccount(id, user.id);
  }

  // ---------- Réservé à l'exploitant de la plateforme ----------

  @Roles(AdminRole.SUPER_ADMIN)
  @Get()
  findAll() {
    return this.tenants.findAll();
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post(':id/activate')
  activate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.setStatus(id, TenantStatus.ACTIVE, user.id);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post(':id/suspend')
  suspend(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.setStatus(id, TenantStatus.SUSPENDED, user.id);
  }
}
