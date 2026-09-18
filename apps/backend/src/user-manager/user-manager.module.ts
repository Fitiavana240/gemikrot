import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { UserManagerService } from './user-manager.service.js';
import { UserManagerController } from './user-manager.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [UserManagerController],
  providers: [UserManagerService],
  exports: [UserManagerService],
})
export class UserManagerModule {}
