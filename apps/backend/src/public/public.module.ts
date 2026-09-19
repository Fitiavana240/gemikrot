import { Module } from '@nestjs/common';
import { PublicService } from './public.service.js';
import { PublicController } from './public.controller.js';

@Module({
  controllers: [PublicController],
  providers: [PublicService],
  exports: [PublicService],
})
export class PublicModule {}
