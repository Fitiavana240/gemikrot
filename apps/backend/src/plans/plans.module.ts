import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PlansService } from './plans.service.js';
import { PlanProvisioningService } from './plan-provisioning.service.js';
import { PlansController } from './plans.controller.js';
import { RapprochementProfilsService } from './rapprochement-profils.service.js';

@Module({
  // `RapprochementProfilsService` journalise la creation d'une offre
  // depuis un profil : sans cet import, l'application ne demarre pas.
  imports: [AuditModule],
  controllers: [PlansController],
  providers: [PlansService, PlanProvisioningService, RapprochementProfilsService],
  exports: [PlansService, PlanProvisioningService],
})
export class PlansModule {}
