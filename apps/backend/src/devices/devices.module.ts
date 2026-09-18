import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DeviceDetectionService } from './device-detection.service.js';
import { DevicesService } from './devices.service.js';
import { DevicesController } from './devices.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [DevicesController],
  providers: [DevicesService, DeviceDetectionService],
  exports: [DevicesService, DeviceDetectionService],
})
export class DevicesModule {}
