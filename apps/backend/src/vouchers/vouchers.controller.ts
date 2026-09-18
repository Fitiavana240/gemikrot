import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AdminRole, VoucherStatus } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { VouchersService } from './vouchers.service.js';
import { CreateVoucherBatchDto } from './dto/create-voucher-batch.dto.js';

const CAN_MANAGE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.OPERATOR];

@Controller('vouchers')
export class VouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  @Get()
  findAll(@Query('status') status?: VoucherStatus, @Query('planId') planId?: string) {
    return this.vouchersService.findAll({ status, planId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vouchersService.findOne(id);
  }

  @Roles(...CAN_MANAGE)
  @Post('batches')
  generateBatch(@Body() dto: CreateVoucherBatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vouchersService.generateBatch(dto, user.id);
  }

  @Roles(...CAN_MANAGE)
  @Patch(':id/disable')
  disable(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vouchersService.disable(id, user.id);
  }

  @Roles(...CAN_MANAGE)
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vouchersService.cancel(id, user.id);
  }
}
