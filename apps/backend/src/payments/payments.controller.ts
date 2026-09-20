import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { PaymentsService } from './payments.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';

const CAN_MANAGE: AdminRole[] = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.OPERATOR];

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    // Seuls les roles qui valident un paiement ont besoin de la reference en
    // clair : elle permet de se faire rendre un code sur la page publique.
    return this.paymentsService.findAll(CAN_MANAGE.includes(user.role));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  @Roles(...CAN_MANAGE)
  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(dto);
  }

  @Roles(...CAN_MANAGE)
  @Post(':id/verify')
  verify(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.verifyPayment(id, user.id);
  }

  @Roles(...CAN_MANAGE)
  @Post(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body('reason') reason?: string) {
    return this.paymentsService.reject(id, user.id, reason);
  }
}
