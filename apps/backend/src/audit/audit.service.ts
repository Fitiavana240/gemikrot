import { Injectable } from '@nestjs/common';
import { AuditResult, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  adminUserId?: string;
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
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        adminUserId: entry.adminUserId,
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
