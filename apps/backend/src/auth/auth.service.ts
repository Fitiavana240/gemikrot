import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminRole, TenantStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { SignupDto } from './dto/signup.dto.js';
import { reserveTenantSlug } from '../tenants/tenant-slug.util.js';

export interface LoginResult {
  accessToken: string;
  user: { id: string; email: string; role: AdminRole; tenantId: string | null };
}

/** Politique appliquée là où elle a du sens : à la définition du mot de passe. */
export const MIN_PASSWORD_LENGTH = 6;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto, ipAddress?: string): Promise<LoginResult> {
    // Client brut : l'authentification précède la résolution de l'exploitant.
    const admin = await this.prisma.adminUser.findUnique({
      where: { email: dto.email },
      include: { tenant: true },
    });
    const passwordValid = admin ? await bcrypt.compare(dto.password, admin.passwordHash) : false;

    if (!admin || !passwordValid) {
      await this.audit.log({
        action: 'LOGIN',
        targetType: 'AdminUser',
        targetId: admin?.id,
        ipAddress,
        result: 'FAILURE',
      });
      throw new UnauthorizedException('Identifiants invalides');
    }

    // Un exploitant non activé ne doit pas pouvoir travailler, même si ses
    // identifiants sont bons (Section : activation par le SUPER_ADMIN).
    if (admin.tenant && admin.tenant.status !== TenantStatus.ACTIVE) {
      await this.audit.log({
        adminUserId: admin.id,
        tenantId: admin.tenantId ?? undefined,
        action: 'LOGIN',
        targetType: 'AdminUser',
        targetId: admin.id,
        ipAddress,
        result: 'FAILURE',
        payloadDiff: { tenantStatus: admin.tenant.status },
      });
      throw new ForbiddenException(
        admin.tenant.status === TenantStatus.PENDING
          ? "Votre compte est en attente d'activation par l'administrateur de la plateforme"
          : 'Votre compte a été suspendu',
      );
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.log({
      adminUserId: admin.id,
      tenantId: admin.tenantId ?? undefined,
      action: 'LOGIN',
      targetType: 'AdminUser',
      targetId: admin.id,
      ipAddress,
      result: 'SUCCESS',
    });

    return {
      accessToken: await this.signToken(admin),
      user: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        tenantId: admin.tenantId,
      },
    };
  }

  /**
   * Inscription libre d'un exploitant. Le compte est créé en `PENDING` :
   * il ne devient utilisable qu'après activation par le SUPER_ADMIN.
   */
  async signup(dto: SignupDto, ipAddress?: string) {
    if (dto.password.length < MIN_PASSWORD_LENGTH) {
      throw new ConflictException(
        `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`,
      );
    }

    const existing = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Un compte existe déjà avec cet email');
    }

    const slug = await reserveTenantSlug(
      dto.organizationName,
      async (candidate) => (await this.prisma.tenant.count({ where: { slug: candidate } })) > 0,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug,
          name: dto.organizationName,
          wifiName: dto.wifiName,
          domains: dto.domains ?? [],
          logoUrl: dto.logoUrl,
          currency: dto.currency,
          mobileMoneyAccounts: dto.mobileMoneyAccounts?.length
            ? {
                create: dto.mobileMoneyAccounts.map((account) => ({
                  provider: account.provider,
                  phoneNumber: account.phoneNumber,
                  accountName: account.accountName,
                })),
              }
            : undefined,
        },
      });

      const admin = await tx.adminUser.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          passwordHash: await bcrypt.hash(dto.password, 10),
          role: AdminRole.ADMIN,
        },
      });

      return { tenant, admin };
    });

    await this.audit.log({
      tenantId: created.tenant.id,
      action: 'SIGNUP',
      targetType: 'Tenant',
      targetId: created.tenant.id,
      ipAddress,
      payloadDiff: { organizationName: dto.organizationName, currency: dto.currency },
    });

    return {
      tenantId: created.tenant.id,
      status: created.tenant.status,
      message: "Compte créé. Il sera utilisable après activation par l'administrateur.",
    };
  }

  private signToken(admin: { id: string; email: string; role: AdminRole; tenantId: string | null }) {
    return this.jwt.signAsync({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      tenantId: admin.tenantId,
    });
  }
}
