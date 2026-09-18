import { Module } from '@nestjs/common';
import { PlansService } from './plans.service.js';
import { PlansController } from './plans.controller.js';

@Module({
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
