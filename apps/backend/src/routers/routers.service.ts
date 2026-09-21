import { Injectable, NotFoundException } from '@nestjs/common';
import { Router } from '@prisma/client';
import { connect as tlsConnect } from 'node:tls';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { AbonnementPlateformeService } from '../tenants/abonnement-plateforme.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RouterCredentialsService } from './router-credentials.service.js';
import type { RouterHealth, RouterReachability } from './router-health.service.js';
import { RouterHealthService } from './router-health.service.js';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';
import type { CreateRouterDto, UpdateRouterDto } from './dto/create-router.dto.js';

/**
 * Vue exposée par l'API : jamais d'identifiants, même chiffrés, et l'état de
 * joignabilité observé — sans lui le disjoncteur travaillerait en aveugle et
 * l'exploitant verrait des erreurs sans savoir quel routeur est en cause.
 */
export type RouterView = Omit<Router, 'credentialsEncrypted'> & {
  health: {
    state: RouterReachability;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
    lastErrorMessage: string | null;
    /** Vrai quand les appels sont suspendus le temps du repos. */
    suspended: boolean;
  };
};

function toView(router: Router, health: RouterHealth): RouterView {
  const { credentialsEncrypted: _omit, ...view } = router;
  return {
    ...view,
    health: {
      state: health.state,
      lastSuccessAt: health.lastSuccessAt,
      lastFailureAt: health.lastFailureAt,
      lastErrorMessage: health.lastErrorMessage,
      suspended: health.openUntil !== null && health.openUntil.getTime() > Date.now(),
    },
  };
}

@Injectable()
export class RoutersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: RouterCredentialsService,
    private readonly clients: MikrotikClientFactory,
    private readonly audit: AuditService,
    private readonly health: RouterHealthService,
    private readonly tenantContext: TenantContextService,
    private readonly abonnement: AbonnementPlateformeService,
  ) {}

  async findAll(): Promise<RouterView[]> {
    const routers = await this.prisma.scoped.router.findMany({ orderBy: { createdAt: 'asc' } });
    return routers.map((router) => toView(router, this.health.get(router.id)));
  }

  async findOne(id: string): Promise<RouterView> {
    const router = await this.requireRouter(id);
    return toView(router, this.health.get(router.id));
  }

  async create(dto: CreateRouterDto, adminUserId?: string): Promise<RouterView> {
    // Le plafond de l'offre se vérifie **à la création**, jamais après :
    // retirer l'accès à un routeur déjà raccordé parce que l'offre a changé
    // couperait la main à quelqu'un qui s'en sert.
    await this.abonnement.exigerRouteurDisponible(this.tenantContext.requireTenantId());

    const router = await this.prisma.scoped.router.create({
      data: {
        tenantId: this.tenantContext.requireTenantId(),
        label: dto.label,
        host: dto.host,
        restPort: dto.restPort ?? 443,
        tlsFingerprint: dto.tlsFingerprint,
        credentialsEncrypted: this.credentials.encrypt({
          username: dto.username,
          password: dto.password,
        }),
      },
    });
    await this.audit.log({
      adminUserId,
      routerId: router.id,
      action: 'CREATE_ROUTER',
      targetType: 'Router',
      targetId: router.id,
      payloadDiff: { label: dto.label, host: dto.host },
    });
    return toView(router, this.health.get(router.id));
  }

  async update(id: string, dto: UpdateRouterDto, adminUserId?: string): Promise<RouterView> {
    const existing = await this.requireRouter(id);

    // Le mot de passe n'est réécrit que s'il est fourni : on repart sinon des
    // identifiants déjà enregistrés.
    const current = this.credentials.decrypt(existing.credentialsEncrypted);
    const credentialsChanged = dto.username !== undefined || dto.password !== undefined;

    const router = await this.prisma.scoped.router.update({
      where: { id },
      data: {
        label: dto.label,
        host: dto.host,
        restPort: dto.restPort,
        tlsFingerprint: dto.tlsFingerprint,
        credentialsEncrypted: credentialsChanged
          ? this.credentials.encrypt({
              username: dto.username ?? current.username,
              password: dto.password ?? current.password,
            })
          : undefined,
      },
    });

    this.clients.invalidate(id);
    await this.audit.log({
      adminUserId,
      routerId: id,
      action: 'UPDATE_ROUTER',
      targetType: 'Router',
      targetId: id,
      payloadDiff: { label: dto.label, host: dto.host, credentialsChanged },
    });
    return toView(router, this.health.get(router.id));
  }

  /** Vérifie que le routeur répond et met à jour son statut en base. */
  async testConnection(id: string) {
    const router = await this.requireRouter(id);
    try {
      const service = await this.clients.forRouter(id);
      const [identity, resource] = await Promise.all([
        service.getRouterIdentity(),
        service.getSystemResource(),
      ]);
      await this.prisma.scoped.router.update({
        where: { id },
        data: { status: 'online', lastSeenAt: new Date() },
      });
      return { reachable: true as const, identity, version: resource.version, uptime: resource.uptime };
    } catch (error) {
      await this.prisma.scoped.router.update({ where: { id }, data: { status: 'unreachable' } });
      return {
        reachable: false as const,
        host: router.host,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      };
    }
  }

  /**
   * Lit l'empreinte SHA-256 du certificat présenté par le routeur, pour
   * permettre son épinglage sans avoir à la relever à la main sur le routeur.
   */
  async probeFingerprint(host: string, port = 443): Promise<{ fingerprint256: string }> {
    return new Promise((resolve, reject) => {
      const socket = tlsConnect(
        { host, port, rejectUnauthorized: false, servername: host },
        () => {
          const certificate = socket.getPeerCertificate();
          socket.end();
          if (!certificate?.fingerprint256) {
            reject(new Error(`Aucun certificat présenté par ${host}:${port}`));
            return;
          }
          resolve({ fingerprint256: certificate.fingerprint256 });
        },
      );
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error(`Délai dépassé en joignant ${host}:${port}`));
      });
      socket.on('error', reject);
    });
  }

  private async requireRouter(id: string): Promise<Router> {
    const router = await this.prisma.scoped.router.findUnique({ where: { id } });
    if (!router) throw new NotFoundException(`Routeur ${id} introuvable`);
    return router;
  }
}
