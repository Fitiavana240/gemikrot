import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { AdminUsersModule } from './admin-users/admin-users.module.js';
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
import { UserManagerModule } from './user-manager/user-manager.module.js';
import { TicketsModule } from './tickets/tickets.module.js';
import { HotspotModule } from './hotspot/hotspot.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TenancyModule,
    PrismaModule,
    TenantsModule,
    AdminUsersModule,
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
    UserManagerModule,
    TicketsModule,
    HotspotModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
