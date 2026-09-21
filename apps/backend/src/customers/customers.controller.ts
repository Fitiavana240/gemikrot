import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CustomersService } from './customers.service.js';
import { ConsommationService } from './consommation.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { RegisterDeviceDto } from './dto/register-device.dto.js';

const CAN_WRITE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.OPERATOR];

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly consommation: ConsommationService,
  ) {}

  @Get()
  findAll() {
    return this.customersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Roles(...CAN_WRITE)
  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Roles(...CAN_WRITE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }

  @Roles(...CAN_WRITE)
  @Patch(':id/disable')
  disable(@Param('id') id: string) {
    return this.customersService.disable(id);
  }

  @Roles(...CAN_WRITE)
  @Patch(':id/enable')
  enable(@Param('id') id: string) {
    return this.customersService.enable(id);
  }

  /** La fiche complete : tickets, abonnements, appareils, paiements. */
  @Get(':id/fiche')
  fiche(@Param('id') id: string) {
    return this.customersService.fiche(id);
  }

  /**
   * CLI-4 : ce que le client a reellement consomme, duree et volume.
   *
   * La source est la comptabilite RADIUS du routeur, qui seul voit les
   * connexions. Son journal etant court, le total rendu est un plancher : le
   * nombre de sessions qu'il contient repart avec, pour qu'on puisse en
   * juger.
   */
  @Get(':id/consommation')
  consommationDuClient(@Param('id') id: string, @Query('routerId') routerId?: string) {
    return this.consommation.pourClient(id, routerId);
  }

  @Get(':id/devices')
  listDevices(@Param('id') id: string) {
    return this.customersService.listDevices(id);
  }

  @Roles(...CAN_WRITE)
  @Post(':id/devices')
  registerDevice(@Param('id') id: string, @Body() dto: RegisterDeviceDto) {
    return this.customersService.registerDevice(id, dto);
  }
}
