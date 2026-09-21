import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VouchersModule } from '../vouchers/vouchers.module.js';
import { JobLockService } from './job-lock.service.js';
import { ExpiryJobService } from './expiry-job.service.js';
import { PurgeJobService } from './purge-job.service.js';
import { SchedulerService } from './scheduler.service.js';
import { SchedulingController } from './scheduling.controller.js';

/**
 * Les travaux de fond. `RoutersModule` est global, d'où l'absence d'import :
 * la fabrique de clients, la file différée et le service de coupure viennent
 * de là.
 */
@Module({
  imports: [ConfigModule, VouchersModule],
  controllers: [SchedulingController],
  providers: [JobLockService, ExpiryJobService, PurgeJobService, SchedulerService],
  exports: [JobLockService, ExpiryJobService, PurgeJobService],
})
export class SchedulingModule {}
