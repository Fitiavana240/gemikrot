import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CourrielModule } from '../courriel/courriel.module.js';
import { TenantsService } from './tenants.service.js';
import { TenantsController } from './tenants.controller.js';
import { MiseEnRouteService } from './mise-en-route.service.js';
import { AbonnementPlateformeService } from './abonnement-plateforme.service.js';
import { SupervisionService } from './supervision.service.js';

@Module({
  // La confirmation d'abonnement part du serveur de la plateforme.
  imports: [AuditModule, CourrielModule],
  controllers: [TenantsController],
  providers: [TenantsService, MiseEnRouteService, AbonnementPlateformeService, SupervisionService],
  exports: [TenantsService, AbonnementPlateformeService],
})
export class TenantsModule {}
