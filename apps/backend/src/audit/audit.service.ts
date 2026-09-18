import { Injectable } from '@nestjs/common';
import { AuditResult, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';

export interface AuditEntry {
  adminUserId?: string;
  /** Renseigné automatiquement depuis le contexte si absent. */
  tenantId?: string;
  routerId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  payloadDiff?: Prisma.InputJsonValue;
  ipAddress?: string;
  result?: AuditResult;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        adminUserId: entry.adminUserId,
        // Une action du SUPER_ADMIN ne vise aucun exploitant : tenantId reste nul.
        tenantId: entry.tenantId ?? this.tenantContext.get()?.tenantId ?? null,
        routerId: entry.routerId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        payloadDiff: entry.payloadDiff,
        ipAddress: entry.ipAddress,
        result: entry.result ?? AuditResult.SUCCESS,
      },
    });
  }
}
