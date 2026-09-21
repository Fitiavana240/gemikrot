import { Module } from '@nestjs/common';
import { CourrielModule } from '../courriel/courriel.module.js';
import { PublicService } from './public.service.js';
import { PublicController } from './public.controller.js';

@Module({
  // Prevenir les administrateurs qu'un client attend son code.
  imports: [CourrielModule],
  controllers: [PublicController],
  providers: [PublicService],
  exports: [PublicService],
})
export class PublicModule {}
