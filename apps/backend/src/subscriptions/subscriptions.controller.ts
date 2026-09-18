import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AdminRole, SubscriptionStatus } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { CreateSubscriptionDto } from './dto/create-subscription.dto.js';

const CAN_MANAGE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.OPERATOR];

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  findAll(
    @Query('status') status?: SubscriptionStatus,
    @Query('customerId') customerId?: string,
  ) {
    return this.subscriptions.findAll({ status, customerId });
  }

  /** Ce que l'administration devrait traiter — aucune action automatique. */
  @Get('recommendations')
  getRecommendations() {
    return this.subscriptions.getRecommendations();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.subscriptions.findOne(id);
  }

  @Roles(...CAN_MANAGE)
  @Post()
  create(@Body() dto: CreateSubscriptionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.create(dto, user.id);
  }

  @Roles(...CAN_MANAGE)
  @Post(':id/suspend')
  suspend(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.suspend(id, user.id);
  }

  @Roles(...CAN_MANAGE)
  @Post(':id/resume')
  resume(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.resume(id, user.id);
  }

  @Roles(...CAN_MANAGE)
  @Post(':id/renew')
  renew(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.renew(id, undefined, user.id);
  }
}
