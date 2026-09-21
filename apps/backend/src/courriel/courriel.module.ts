import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CourrielService } from './courriel.service.js';
import { CourrielController } from './courriel.controller.js';

@Module({
  // `CourrielService` journalise le reglage du SMTP : sans cet import,
  // l'application ne demarre pas.
  imports: [AuditModule],
  controllers: [CourrielController],
  providers: [CourrielService],
  exports: [CourrielService],
})
export class CourrielModule {}
