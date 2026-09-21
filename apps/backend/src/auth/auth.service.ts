import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminRole, TenantStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { SignupDto } from './dto/signup.dto.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
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
    private readonly throttle: LoginThrottleService,
  ) {}

  async login(dto: LoginDto, ipAddress?: string): Promise<LoginResult> {
    // Avant toute lecture : inutile de consulter la base pour un appelant
    // qui a déjà épuisé ses essais, et cela évite d'en faire un levier.
    this.throttle.verifier(dto.email, ipAddress);

    // Client brut : l'authentification précède la résolution de l'exploitant.
    const admin = await this.prisma.adminUser.findUnique({
      where: { email: dto.email },
      include: { tenant: true },
    });
    const passwordValid = admin ? await bcrypt.compare(dto.password, admin.passwordHash) : false;

    if (!admin || !passwordValid) {
      // Compté qu'il existe ou non : ne compter que les comptes connus dirait
      // à l'attaquant lesquels existent.
      this.throttle.echec(dto.email, ipAddress);
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

    // L'ardoise est effacée ici et non plus haut : un compte suspendu n'a
    // pas réussi à se connecter, ses essais doivent continuer de compter.
    this.throttle.succes(dto.email, ipAddress);
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
   * Changer son propre mot de passe.
   *
   * Il n'existait aucun moyen de le faire — ni ici, ni dans l'interface. Un
   * mot de passe éventé ne laissait qu'une porte de sortie : créer un autre
   * compte d'administration et supprimer l'ancien.
   *
   * L'ancien mot de passe est revérifié bien que la session soit authentifiée :
   * un écran resté ouvert ne doit pas permettre d'enfermer son propriétaire
   * dehors.
   */
  async changePassword(
    adminUserId: string,
    dto: ChangePasswordDto,
    ipAddress?: string,
  ): Promise<{ ok: true }> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminUserId } });
    // Le jeton est valide mais le compte a disparu : traité comme un échec
    // d'authentification, pas comme une erreur interne.
    if (!admin) throw new UnauthorizedException('Identifiants invalides');

    const valide = await bcrypt.compare(dto.currentPassword, admin.passwordHash);
    if (!valide) {
      await this.audit.log({
        adminUserId: admin.id,
        tenantId: admin.tenantId ?? undefined,
        action: 'UPDATE',
        targetType: 'AdminUser',
        targetId: admin.id,
        ipAddress,
        result: 'FAILURE',
        payloadDiff: { champ: 'passwordHash' },
      });
      throw new UnauthorizedException('Mot de passe actuel incorrect');
    }

    if (dto.newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`,
      );
    }
    // Revalider l'ancien ne sert à rien si l'on accepte le même : le
    // changement doit changer quelque chose.
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('Le nouveau mot de passe doit être différent de l’ancien');
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });
    await this.audit.log({
      adminUserId: admin.id,
      tenantId: admin.tenantId ?? undefined,
      action: 'UPDATE',
      targetType: 'AdminUser',
      targetId: admin.id,
      ipAddress,
      result: 'SUCCESS',
      // Jamais le mot de passe, ni son empreinte : seulement qu'il a changé.
      payloadDiff: { champ: 'passwordHash' },
    });

    return { ok: true };
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
