import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminUsersController } from './admin-users.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
