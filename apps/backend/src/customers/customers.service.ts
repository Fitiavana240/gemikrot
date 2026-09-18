import { Injectable, NotFoundException } from '@nestjs/common';
import { Customer, Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import type { CreateCustomerDto } from './dto/create-customer.dto.js';
import type { UpdateCustomerDto } from './dto/update-customer.dto.js';
import type { RegisterDeviceDto } from './dto/register-device.dto.js';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  findAll(): Promise<Customer[]> {
    return this.prisma.scoped.customer.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string): Promise<Customer> {
    const customer = await this.prisma.scoped.customer.findUnique({
      where: { id },
      include: { devices: true },
    });
    if (!customer) throw new NotFoundException(`Client ${id} introuvable`);
    return customer;
  }

  create(dto: CreateCustomerDto): Promise<Customer> {
    return this.prisma.scoped.customer.create({
      data: { ...dto, tenantId: this.tenantContext.requireTenantId() },
    });
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    await this.findOne(id);
    return this.prisma.scoped.customer.update({ where: { id }, data: dto });
  }

  async disable(id: string): Promise<Customer> {
    await this.findOne(id);
    return this.prisma.scoped.customer.update({ where: { id }, data: { status: 'DISABLED' } });
  }

  async enable(id: string): Promise<Customer> {
    await this.findOne(id);
    return this.prisma.scoped.customer.update({ where: { id }, data: { status: 'ACTIVE' } });
  }

  async registerDevice(customerId: string, dto: RegisterDeviceDto): Promise<Device> {
    await this.findOne(customerId);
    return this.prisma.scoped.device.create({
      data: { ...dto, customerId, tenantId: this.tenantContext.requireTenantId() },
    });
  }

  async listDevices(customerId: string): Promise<Device[]> {
    await this.findOne(customerId);
    return this.prisma.scoped.device.findMany({
      where: { customerId },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
