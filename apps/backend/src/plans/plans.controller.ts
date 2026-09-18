import { Body, Controller, Get, Param, Patch, Post, Delete } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { PlansService } from './plans.service.js';
import { PlanProvisioningService } from './plan-provisioning.service.js';
import { CreatePlanDto } from './dto/create-plan.dto.js';
import { UpdatePlanDto } from './dto/update-plan.dto.js';

@Controller('plans')
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
    private readonly provisioning: PlanProvisioningService,
  ) {}

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
  inspectUserManager(@Param('id') id: string) {
    return this.provisioning.inspect(id);
  }

  /** Réaligne le routeur sur l'offre : profil, limitation et jonction. */
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Post(':id/sync-user-manager')
  syncUserManager(@Param('id') id: string) {
    return this.provisioning.reconcile(id);
  }
}
