import { Injectable, NotFoundException } from '@nestjs/common';
import { Customer, Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateCustomerDto } from './dto/create-customer.dto.js';
import type { UpdateCustomerDto } from './dto/update-customer.dto.js';
import type { RegisterDeviceDto } from './dto/register-device.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Customer[]> {
    return this.prisma.customer.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string): Promise<Customer> {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { devices: true },
    });
    if (!customer) throw new NotFoundException(`Client ${id} introuvable`);
    return customer;
  }

  create(dto: CreateCustomerDto): Promise<Customer> {
    return this.prisma.customer.create({ data: dto });
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    await this.findOne(id);
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  async disable(id: string): Promise<Customer> {
    await this.findOne(id);
    return this.prisma.customer.update({ where: { id }, data: { status: 'DISABLED' } });
  }

  async enable(id: string): Promise<Customer> {
    await this.findOne(id);
    return this.prisma.customer.update({ where: { id }, data: { status: 'ACTIVE' } });
  }

  async registerDevice(customerId: string, dto: RegisterDeviceDto): Promise<Device> {
    await this.findOne(customerId);
    return this.prisma.device.create({
      data: { ...dto, customerId },
    });
  }

  async listDevices(customerId: string): Promise<Device[]> {
    await this.findOne(customerId);
    return this.prisma.device.findMany({
      where: { customerId },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
