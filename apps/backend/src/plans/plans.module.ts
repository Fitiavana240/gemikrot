import { Module } from '@nestjs/common';
import { MikrotikModule } from '../mikrotik/mikrotik.module.js';
import { PlansService } from './plans.service.js';
import { PlansController } from './plans.controller.js';

@Module({
  imports: [MikrotikModule],
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
