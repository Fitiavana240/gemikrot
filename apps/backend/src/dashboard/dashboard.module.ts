import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { DashboardController } from './dashboard.controller.js';
import { RecettesService } from './recettes.service.js';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, RecettesService],
})
export class DashboardModule {}
