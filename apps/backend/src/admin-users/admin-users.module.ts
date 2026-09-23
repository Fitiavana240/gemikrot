import { Module } from '@nestjs/common';
import { CourrielModule } from '../courriel/courriel.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminUsersController } from './admin-users.controller.js';

@Module({
  imports: [AuditModule, CourrielModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
