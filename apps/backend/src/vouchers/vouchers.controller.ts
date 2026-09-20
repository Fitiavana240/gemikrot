import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AdminRole, VoucherStatus } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { VouchersService } from './vouchers.service.js';
import { CreateVoucherBatchDto } from './dto/create-voucher-batch.dto.js';
import { VoucherReconciliationService } from './voucher-reconciliation.service.js';

const CAN_MANAGE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.OPERATOR];

@Controller('vouchers')
export class VouchersController {
  constructor(
    private readonly vouchersService: VouchersService,
    private readonly reconciliation: VoucherReconciliationService,
  ) {}

  @Get()
  findAll(
    @Query('status') status?: VoucherStatus,
    @Query('planId') planId?: string,
    @Query('scope') scope?: 'um' | 'legacy',
  ) {
    return this.vouchersService.findAll({ status, planId, scope });
  }

  /** Tickets expirés, statut posé ou échéance dépassée. */
  @Get('expired')
  findExpired() {
    return this.vouchersService.findExpired();
  }

  /** Répartition des tickets par offre. */
  @Get('by-plan')
  countByPlan() {
    return this.vouchersService.countByPlan();
  }

  /** Relit les échéances sur le routeur et coupe les accès périmés. */
  @Roles(...CAN_MANAGE)
  @Post('reconcile')
  reconcile(@Query('routerId') routerId?: string) {
    return this.reconciliation.reconcileTenant(routerId);
  }

  /** Les lots generes et ce qu'ils sont devenus. */
  @Get('batches')
  listBatches() {
    return this.vouchersService.listBatches();
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
