import { Module } from '@nestjs/common';
import { MikrotikModule } from '../mikrotik/mikrotik.module.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardController } from './dashboard.controller.js';

@Module({
  imports: [MikrotikModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
