import { Injectable, NotFoundException } from '@nestjs/common';
import { Customer, Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import type { CreateCustomerDto } from './dto/create-customer.dto.js';
import type { UpdateCustomerDto } from './dto/update-customer.dto.js';
import type { RegisterDeviceDto } from './dto/register-device.dto.js';
import { isUsablePhone, normalizePhone } from '../public/payment-normalization.js';

/**
 * Le numéro tel qu'il se range en base.
 *
 * `034 03 941 88`, `+261 34 03 941 88` et `0340394188` sont le même numéro.
 * Rangés tels quels, ils faisaient trois fiches là où la contrainte d'unicité
 * `(tenantId, phone)` ne voyait aucun doublon — et le jour où l'on cherche
 * « qui a ce numéro », on n'en trouve qu'un tiers.
 *
 * Deux valeurs restent intouchées, et c'est délibéré. L'identifiant
 * provisoire de l'import (`import:<compte>`) n'est pas un numéro : le
 * normaliser le réduirait à rien, et tout ce qui le reconnaît par son préfixe
 * cesserait de fonctionner. Et ce qui ne donne pas un numéro malgache
 * plausible est gardé tel que tapé, plutôt que réduit à des chiffres
 * méconnaissables : mieux vaut un numéro étranger lisible qu'une bouillie.
 */
function rangerNuméro(brut: string): string {
  if (brut.startsWith('import:')) return brut;
  const normalisé = normalizePhone(brut);
  return isUsablePhone(normalisé) ? normalisé : brut;
}

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
      data: { ...dto, phone: rangerNuméro(dto.phone), tenantId: this.tenantContext.requireTenantId() },
    });
  }


  /**
   * Tout ce qui concerne un client, en une lecture.
   *
   * Les donnees existaient deja, eclatees sur cinq ecrans : pour repondre a
   * « ce client a-t-il paye ? », il fallait ouvrir Clients, Tickets,
   * Abonnements, Paiements et Appareils, et se souvenir de son nom entre
   * chaque. La question est frequente au comptoir ; la reponse tenait en cinq
   * navigations.
   *
   * Les collections sont bornees : une fiche sert a decider, pas a archiver.
   * Qui veut l'historique complet a les ecrans dedies, avec leurs filtres.
   */
  async fiche(id: string) {
    const client = await this.findOne(id);

    const [tickets, abonnements, appareils, paiements] = await Promise.all([
      this.prisma.scoped.voucher.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          code: true,
          status: true,
          expiresAt: true,
          umUsername: true,
          plan: { select: { name: true } },
        },
      }),
      this.prisma.scoped.subscription.findMany({
        where: { customerId: id },
        orderBy: { currentPeriodEnd: 'desc' },
        select: {
          id: true,
          status: true,
          hotspotUsername: true,
          currentPeriodEnd: true,
          graceEndsAt: true,
          plan: { select: { name: true } },
        },
      }),
      this.prisma.scoped.device.findMany({
        where: { customerId: id },
        orderBy: { lastSeenAt: 'desc' },
        select: {
          id: true,
          macAddress: true,
          hostname: true,
          type: true,
          bypassEnabled: true,
          lastSeenAt: true,
        },
      }),
      this.prisma.scoped.payment.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          status: true,
          reference: true,
          createdAt: true,
        },
      }),
    ]);

    return { client, tickets, abonnements, appareils, paiements };
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    await this.findOne(id);
    return this.prisma.scoped.customer.update({
      where: { id },
      data: dto.phone === undefined ? dto : { ...dto, phone: rangerNuméro(dto.phone) },
    });
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
