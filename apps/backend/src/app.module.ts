import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RoutersModule } from './routers/routers.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PlansModule } from './plans/plans.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { VouchersModule } from './vouchers/vouchers.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { DevicesModule } from './devices/devices.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RoutersModule,
    AuditModule,
    AuthModule,
    PlansModule,
    CustomersModule,
    VouchersModule,
    PaymentsModule,
    DashboardModule,
    SubscriptionsModule,
    DevicesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
