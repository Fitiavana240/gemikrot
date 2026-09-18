import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { VouchersService } from './vouchers.service.js';
import { VouchersController } from './vouchers.controller.js';
import { VoucherAccessService } from './voucher-access.service.js';
import { VoucherReconciliationService } from './voucher-reconciliation.service.js';

@Module({
  imports: [AuditModule, PlansModule],
  controllers: [VouchersController],
  providers: [VouchersService, VoucherAccessService, VoucherReconciliationService],
  exports: [VouchersService, VoucherAccessService, VoucherReconciliationService],
})
export class VouchersModule {}
