import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { VouchersService } from './vouchers.service.js';
import { VouchersController } from './vouchers.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [VouchersController],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}
