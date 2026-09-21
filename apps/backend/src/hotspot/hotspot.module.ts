import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { VouchersModule } from '../vouchers/vouchers.module.js';
import { HotspotService } from './hotspot.service.js';
import { HotspotController } from './hotspot.controller.js';
import { PageConnexionService } from './page-connexion.service.js';

@Module({
  imports: [AuditModule, VouchersModule],
  controllers: [HotspotController],
  providers: [HotspotService, PageConnexionService],
  exports: [HotspotService],
})
export class HotspotModule {}
