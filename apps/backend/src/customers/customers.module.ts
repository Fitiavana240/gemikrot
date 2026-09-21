import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { CustomersController } from './customers.controller.js';
import { ConsommationService } from './consommation.service.js';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, ConsommationService],
  exports: [CustomersService],
})
export class CustomersModule {}
