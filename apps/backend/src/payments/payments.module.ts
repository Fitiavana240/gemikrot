import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { VouchersModule } from '../vouchers/vouchers.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { PaymentsService } from './payments.service.js';
import { PaymentsController } from './payments.controller.js';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface.js';
import { ManualPaymentProvider } from './providers/manual-payment.provider.js';

@Module({
  imports: [AuditModule, VouchersModule, SubscriptionsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    ManualPaymentProvider,
    { provide: PAYMENT_PROVIDER, useExisting: ManualPaymentProvider },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
