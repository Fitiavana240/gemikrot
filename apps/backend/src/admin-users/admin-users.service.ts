import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminRole, AdminUser } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { MIN_PASSWORD_LENGTH } from '../auth/auth.service.js';
import type { CreateAdminUserDto } from './dto/create-admin-user.dto.js';

/** Vue exposée par l'API : jamais le hash du mot de passe. */
export type AdminUserView = Omit<AdminUser, 'passwordHash' | 'mfaSecret'>;

function toView(user: AdminUser): AdminUserView {
  const { passwordHash: _p, mfaSecret: _m, ...view } = user;
  return view;
}

/**
 * Comptes d'accès d'un exploitant. Un ADMIN gère ses propres OPERATOR et
 * VIEWER ; il ne peut ni créer d'autres ADMIN, ni toucher aux comptes d'un
 * autre exploitant.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async findAll(): Promise<AdminUserView[]> {
    const context = this.tenantContext.get();
    const users = await this.prisma.adminUser.findMany({
      where: context?.isSuperAdmin ? {} : { tenantId: context?.tenantId ?? '' },
      orderBy: { createdAt: 'asc' },
    });
    return users.map(toView);
  }

  async create(dto: CreateAdminUserDto, adminUserId?: string): Promise<AdminUserView> {
    const tenantId = this.tenantContext.requireTenantId();

    // Un exploitant délègue des rôles subalternes, il ne se clone pas.
    if (dto.role !== AdminRole.OPERATOR && dto.role !== AdminRole.VIEWER) {
      throw new ForbiddenException('Seuls les rôles OPERATOR et VIEWER peuvent être créés ici');
    }
    if (dto.password.length < MIN_PASSWORD_LENGTH) {
      throw new ConflictException(
        `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`,
      );
    }

    const existing = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Un compte existe déjà avec cet email');

    const user = await this.prisma.adminUser.create({
      data: {
        tenantId,
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: dto.role,
      },
    });
    await this.audit.log({
      adminUserId,
      tenantId,
      action: 'CREATE_ADMIN_USER',
      targetType: 'AdminUser',
      targetId: user.id,
      payloadDiff: { email: dto.email, role: dto.role },
    });
    return toView(user);
  }

  async remove(id: string, adminUserId?: string): Promise<void> {
    const tenantId = this.tenantContext.requireTenantId();
    const user = await this.prisma.adminUser.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundException(`Compte ${id} introuvable`);
    if (user.id === adminUserId) {
      throw new ConflictException('Vous ne pouvez pas supprimer votre propre compte');
    }

    await this.prisma.adminUser.delete({ where: { id } });
    await this.audit.log({
      adminUserId,
      tenantId,
      action: 'DELETE_ADMIN_USER',
      targetType: 'AdminUser',
      targetId: id,
      payloadDiff: { email: user.email },
    });
  }
}
