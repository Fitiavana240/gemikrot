import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { TenantsService } from './tenants.service.js';
import { TenantsController } from './tenants.controller.js';
import { MiseEnRouteService } from './mise-en-route.service.js';

@Module({
  imports: [AuditModule],
  controllers: [TenantsController],
  providers: [TenantsService, MiseEnRouteService],
  exports: [TenantsService],
})
export class TenantsModule {}
