import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { DevicesModule } from '../devices/devices.module.js';
import { RouterAccessService } from './router-access.service.js';
import { RouterCredentialsService } from './router-credentials.service.js';
import { RouterRepairService } from './router-repair.service.js';
import { PppController } from './ppp.controller.js';
import { TicketGenerationController } from './ticket-generation.controller.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { TicketGenerationService } from './ticket-generation.service.js';
import { RouterToolsController } from './router-tools.controller.js';
import { RouterEnrollmentController } from './router-enrollment.controller.js';
import { RouterEnrollmentService } from './router-enrollment.service.js';
import { WireguardService } from './wireguard.service.js';
import { RouterHealthService } from './router-health.service.js';
import { RouterOperationQueue } from './router-operation.service.js';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';
import { RouterImportService } from './router-import.service.js';
import { RoutersService } from './routers.service.js';
import { RoutersController } from './routers.controller.js';
import { RouterMonitoringController } from './router-monitoring.controller.js';

/**
 * Global : tous les modules métier ont besoin d'un client MikroTik résolu par
 * routeur (`MikrotikClientFactory`), qui remplace l'ancien token unique
 * `MIKROTIK_SERVICE` construit depuis `.env`.
 */
@Global()
@Module({
  imports: [ConfigModule, AuditModule, DevicesModule, TicketsModule, TenantsModule],
  controllers: [
    RoutersController,
    RouterMonitoringController,
    RouterEnrollmentController,
    RouterToolsController,
    PppController,
    TicketGenerationController,
  ],
  providers: [
    RouterAccessService,
    WireguardService,
    RouterEnrollmentService,
    RouterCredentialsService,
    RouterRepairService,
    TicketGenerationService,
    RouterHealthService,
    RouterOperationQueue,
    MikrotikClientFactory,
    RoutersService,
    RouterImportService,
  ],
  exports: [
    RouterAccessService,
    WireguardService,
    RouterEnrollmentService,
    RouterCredentialsService,
    RouterHealthService,
    RouterOperationQueue,
    MikrotikClientFactory,
    RoutersService,
    RouterImportService,
  ],
})
export class RoutersModule {}
