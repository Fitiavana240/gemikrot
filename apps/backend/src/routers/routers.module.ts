import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';
import { DevicesModule } from '../devices/devices.module.js';
import { RouterCredentialsService } from './router-credentials.service.js';
import { RouterHealthService } from './router-health.service.js';
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
  imports: [ConfigModule, AuditModule, DevicesModule],
  controllers: [RoutersController, RouterMonitoringController],
  providers: [
    RouterCredentialsService,
    RouterHealthService,
    MikrotikClientFactory,
    RoutersService,
    RouterImportService,
  ],
  exports: [
    RouterCredentialsService,
    RouterHealthService,
    MikrotikClientFactory,
    RoutersService,
    RouterImportService,
  ],
})
export class RoutersModule {}
