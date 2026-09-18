import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { DevicesService } from './devices.service.js';
import { EnableBypassDto, RegisterDeviceDto } from './dto/register-device.dto.js';

const CAN_MANAGE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.OPERATOR];

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  findAll(@Query('customerId') customerId?: string, @Query('subscriptionId') subscriptionId?: string) {
    return this.devices.findAll({ customerId, subscriptionId });
  }

  /** Appareils vus par le routeur, avec un type proposé à confirmer. */
  @Get('discover')
  discover(@Query('routerId') routerId?: string) {
    return this.devices.discover(routerId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.devices.findOne(id);
  }

  @Roles(...CAN_MANAGE)
  @Post()
  register(@Body() dto: RegisterDeviceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.devices.register(dto, user.id);
  }

  @Roles(...CAN_MANAGE)
  @Post(':id/bypass')
  enableBypass(
    @Param('id') id: string,
    @Body() dto: EnableBypassDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.devices.enableBypass(id, dto, user.id);
  }

  @Roles(...CAN_MANAGE)
  @Post(':id/block')
  block(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.devices.blockBypass(id, user.id);
  }
}
