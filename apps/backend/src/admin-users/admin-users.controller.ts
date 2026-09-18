import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { AdminUsersService } from './admin-users.service.js';
import { CreateAdminUserDto } from './dto/create-admin-user.dto.js';

@Controller('admin-users')
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Get()
  findAll() {
    return this.adminUsers.findAll();
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Post()
  create(@Body() dto: CreateAdminUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.adminUsers.create(dto, user.id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adminUsers.remove(id, user.id);
  }
}
