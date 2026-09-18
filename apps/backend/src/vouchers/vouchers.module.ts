import { Module } from '@nestjs/common';
import { MikrotikModule } from '../mikrotik/mikrotik.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { VouchersService } from './vouchers.service.js';
import { VouchersController } from './vouchers.controller.js';

@Module({
  imports: [MikrotikModule, AuditModule],
  controllers: [VouchersController],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}
