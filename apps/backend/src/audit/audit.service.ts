import { Injectable } from '@nestjs/common';
import { AuditResult, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';

export interface AuditFilter {
  action?: string;
  targetType?: string;
  adminUserId?: string;
  result?: string;
  /** Date ISO : ne rend que ce qui est survenu depuis. */
  since?: string;
  /** Identifiant de la dernière ligne reçue, pour la page suivante. */
  cursor?: string;
  limit?: number;
}

export interface AuditPage {
  entries: AuditLogView[];
  /** Nul quand il n'y a plus rien après. */
  nextCursor: string | null;
}

/** Ce que la console affiche : le journal brut plus le nom de son auteur. */
export interface AuditLogView {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  result: string;
  ipAddress: string | null;
  createdAt: Date;
  adminUserName: string | null;
  routerLabel: string | null;
  payloadDiff: unknown;
}

/** Au-delà, l'écran devient illisible et la requête coûteuse. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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

  /**
   * Le journal de l'exploitant courant, du plus récent au plus ancien.
   *
   * Pagination par curseur et non par décalage : le journal grossit pendant
   * qu'on le feuillette, et un décalage ferait sauter ou répéter des lignes
   * à chaque nouvelle écriture.
   */
  async list(filter: AuditFilter = {}): Promise<AuditPage> {
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const where: Prisma.AuditLogWhereInput = {
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.targetType ? { targetType: filter.targetType } : {}),
      ...(filter.adminUserId ? { adminUserId: filter.adminUserId } : {}),
      ...(filter.result ? { result: filter.result as AuditResult } : {}),
      ...(filter.since ? { createdAt: { gte: new Date(filter.since) } } : {}),
    };

    // Une ligne de plus que demandé : sa présence dit qu'il y a une suite,
    // sans avoir à compter tout le journal.
    const rows = await this.prisma.scoped.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(filter.cursor ? { skip: 1, cursor: { id: filter.cursor } } : {}),
      include: {
        adminUser: { select: { email: true } },
        router: { select: { label: true } },
      },
    });

    const page = rows.slice(0, limit);
    return {
      entries: page.map((row) => ({
        id: row.id,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        result: row.result,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt,
        // Le compte peut avoir été supprimé depuis : le journal survit à son auteur.
        adminUserName: row.adminUser?.email ?? null,
        routerLabel: row.router?.label ?? null,
        payloadDiff: row.payloadDiff,
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /**
   * Les valeurs réellement présentes dans le journal.
   *
   * Proposer une liste figée d'actions vieillirait mal : chaque nouvelle
   * action du code apparaîtrait dans les lignes sans jamais dans le filtre.
   */
  async facets(): Promise<{ actions: string[]; targetTypes: string[] }> {
    const [actions, targetTypes] = await Promise.all([
      this.prisma.scoped.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' } }),
      this.prisma.scoped.auditLog.groupBy({ by: ['targetType'], orderBy: { targetType: 'asc' } }),
    ]);
    return {
      actions: actions.map((row) => row.action),
      targetTypes: targetTypes.map((row) => row.targetType),
    };
  }
}
