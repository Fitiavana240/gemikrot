import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { VouchersService } from './vouchers.service.js';
import { VouchersController } from './vouchers.controller.js';
import { VoucherReconciliationService } from './voucher-reconciliation.service.js';

@Module({
  imports: [AuditModule, PlansModule, TicketsModule],
  controllers: [VouchersController],
  providers: [VouchersService, VoucherReconciliationService],
  exports: [VouchersService, VoucherReconciliationService],
})
export class VouchersModule {}
