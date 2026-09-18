import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { SubscriptionsController } from './subscriptions.controller.js';

@Module({
  imports: [AuditModule, PlansModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
