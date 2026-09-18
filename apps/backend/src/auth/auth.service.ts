import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { LoginDto } from './dto/login.dto.js';

export interface LoginResult {
  accessToken: string;
  user: { id: string; email: string; role: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto, ipAddress?: string): Promise<LoginResult> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
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

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.log({
      adminUserId: admin.id,
      action: 'LOGIN',
      targetType: 'AdminUser',
      targetId: admin.id,
      ipAddress,
      result: 'SUCCESS',
    });

    const accessToken = await this.jwt.signAsync({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    });

    return { accessToken, user: { id: admin.id, email: admin.email, role: admin.role } };
  }
}
