import { Body, Controller, Get, Param, Patch, Post, Delete, Query } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { PlansService } from './plans.service.js';
import { PlanProvisioningService } from './plan-provisioning.service.js';
import { RapprochementProfilsService } from './rapprochement-profils.service.js';
import { CreatePlanDto } from './dto/create-plan.dto.js';
import { UpdatePlanDto } from './dto/update-plan.dto.js';

@Controller('plans')
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
    private readonly provisioning: PlanProvisioningService,
    private readonly rapprochement: RapprochementProfilsService,
  ) {}

  /**
   * Les profils du routeur en face des offres, dans les deux sens.
   *
   * Une offre sans profil est un risque commercial ; un profil sans offre
   * est de l'argent laisse de cote. Rien ne montrait ni l'un ni l'autre : il
   * fallait ouvrir WinBox a cote de la console.
   */
  @Get('rapprochement')
  rapprocher(@Query('routerId') routerId?: string) {
    return this.rapprochement.rapprocher(routerId);
  }

  /** Cree une offre **archivee** a partir d'un profil du routeur. */
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Post('depuis-profil')
  creerDepuisProfil(
    @Body() body: { profil: string },
    @CurrentUser() user: AuthenticatedUser,
    @Query('routerId') routerId?: string,
  ) {
    return this.rapprochement.creerOffreDepuisProfil(body.profil, user.id, routerId);
  }

  @Get()
  findAll() {
    return this.plansService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.plansService.findOne(id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Post()
  create(@Body() dto: CreatePlanDto) {
    return this.plansService.create(dto);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.plansService.update(id, dto);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.plansService.archive(id);
  }

  /** État du profil User Manager de l'offre, vu du routeur. */
  @Get(':id/user-manager')
  inspectUserManager(@Param('id') id: string, @Query('routerId') routerId?: string) {
    return this.provisioning.inspect(id, routerId);
  }

  /** Réaligne le routeur sur l'offre : profil, limitation et jonction. */
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Post(':id/sync-user-manager')
  syncUserManager(@Param('id') id: string, @Query('routerId') routerId?: string) {
    return this.provisioning.reconcile(id, routerId);
  }
}
