import { Module } from '@nestjs/common';
import { PlansService } from './plans.service.js';
import { PlanProvisioningService } from './plan-provisioning.service.js';
import { PlansController } from './plans.controller.js';
import { RapprochementProfilsService } from './rapprochement-profils.service.js';

@Module({
  controllers: [PlansController],
  providers: [PlansService, PlanProvisioningService, RapprochementProfilsService],
  exports: [PlansService, PlanProvisioningService],
})
export class PlansModule {}
