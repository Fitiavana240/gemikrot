import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MobileMoneyAccount, Tenant, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import type { UpdateTenantDto } from './dto/update-tenant.dto.js';
import type { MobileMoneyAccountDto } from './dto/mobile-money-account.dto.js';

export interface TenantWithAccounts extends Tenant {
  mobileMoneyAccounts: MobileMoneyAccount[];
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Réservé au SUPER_ADMIN : la liste de tous les exploitants. */
  findAll(): Promise<Tenant[]> {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** Les paramètres de l'exploitant connecté. */
  async findMine(): Promise<TenantWithAccounts> {
    const tenantId = this.tenantContext.get()?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException("Le SUPER_ADMIN n'est rattaché à aucun exploitant");
    }
    return this.requireTenant(tenantId);
  }

  async update(dto: UpdateTenantDto, adminUserId?: string): Promise<TenantWithAccounts> {
    const tenantId = this.tenantContext.get()?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException("Le SUPER_ADMIN n'est rattaché à aucun exploitant");
    }

    /**
     * Le slug est unique sur toute la plateforme, pas par exploitant : deux
     * reseaux ne peuvent pas repondre a la meme adresse publique. Prisma
     * leverait bien la contrainte, mais avec un message qui ne nomme ni le
     * champ ni le concurrent.
     */
    if (dto.slug) {
      const pris = await this.prisma.tenant.findFirst({
        where: { slug: dto.slug, id: { not: tenantId } },
        select: { id: true },
      });
      if (pris) {
        throw new ConflictException(
          `L'identifiant public « ${dto.slug} » est déjà utilisé par un autre exploitant.`,
        );
      }
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        slug: dto.slug,
        name: dto.name,
        wifiName: dto.wifiName,
        domains: dto.domains,
        logoUrl: dto.logoUrl,
        currency: dto.currency,
      },
    });
    await this.audit.log({
      adminUserId,
      tenantId,
      action: 'UPDATE_TENANT_SETTINGS',
      targetType: 'Tenant',
      targetId: tenantId,
      payloadDiff: { ...dto },
    });
    return this.requireTenant(tenantId);
  }

  async addMobileMoneyAccount(
    dto: MobileMoneyAccountDto,
    adminUserId?: string,
  ): Promise<MobileMoneyAccount> {
    const tenantId = this.tenantContext.get()?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException("Le SUPER_ADMIN n'est rattaché à aucun exploitant");
    }

    const account = await this.prisma.mobileMoneyAccount.create({
      data: {
        tenantId,
        provider: dto.provider,
        phoneNumber: dto.phoneNumber,
        accountName: dto.accountName,
      },
    });
    await this.audit.log({
      adminUserId,
      tenantId,
      action: 'ADD_MOBILE_MONEY_ACCOUNT',
      targetType: 'MobileMoneyAccount',
      targetId: account.id,
      payloadDiff: { provider: dto.provider, phoneNumber: dto.phoneNumber },
    });
    return account;
  }

  /**
   * Active ou desactive une puce sans la supprimer.
   *
   * Supprimer etait jusqu'ici la seule option offerte, et c'etait la mauvaise :
   * une puce retiree du commerce garde ses paiements passes, qui referencent
   * son numero. La retirer du choix propose au client est une chose ; effacer
   * a quel numero il a paye en est une autre.
   */
  async setMobileMoneyActive(
    id: string,
    isActive: boolean,
    adminUserId?: string,
  ): Promise<MobileMoneyAccount> {
    const account = await this.prisma.scoped.mobileMoneyAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException(`Compte Mobile Money ${id} introuvable`);

    const updated = await this.prisma.scoped.mobileMoneyAccount.update({
      where: { id },
      data: { isActive },
    });
    await this.audit.log({
      adminUserId,
      tenantId: account.tenantId,
      action: isActive ? 'ENABLE_MOBILE_MONEY_ACCOUNT' : 'DISABLE_MOBILE_MONEY_ACCOUNT',
      targetType: 'MobileMoneyAccount',
      targetId: id,
      payloadDiff: { phoneNumber: account.phoneNumber },
    });
    return updated;
  }

  async removeMobileMoneyAccount(id: string, adminUserId?: string): Promise<void> {
    // Passe par le client cloisonné : impossible de supprimer la puce d'un
    // autre exploitant, même en devinant son identifiant.
    const account = await this.prisma.scoped.mobileMoneyAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException(`Compte Mobile Money ${id} introuvable`);

    await this.prisma.mobileMoneyAccount.delete({ where: { id } });
    await this.audit.log({
      adminUserId,
      tenantId: account.tenantId,
      action: 'REMOVE_MOBILE_MONEY_ACCOUNT',
      targetType: 'MobileMoneyAccount',
      targetId: id,
    });
  }

  async setStatus(
    tenantId: string,
    status: TenantStatus,
    adminUserId?: string,
  ): Promise<Tenant> {
    await this.requireTenant(tenantId);
    const tenant = await this.prisma.tenant.update({ where: { id: tenantId }, data: { status } });
    await this.audit.log({
      adminUserId,
      tenantId,
      action: status === TenantStatus.ACTIVE ? 'ACTIVATE_TENANT' : 'SUSPEND_TENANT',
      targetType: 'Tenant',
      targetId: tenantId,
      payloadDiff: { status },
    });
    return tenant;
  }

  private async requireTenant(id: string): Promise<TenantWithAccounts> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: { mobileMoneyAccounts: { orderBy: { createdAt: 'asc' } } },
    });
    if (!tenant) throw new NotFoundException(`Exploitant ${id} introuvable`);
    return tenant;
  }
}
