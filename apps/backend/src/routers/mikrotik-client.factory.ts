import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Router } from '@prisma/client';
import {
  ConsoleLogger,
  RouterOSMikrotikService,
  RouterOSRestClient,
  type IMikrotikService,
  type RouterOSClientConfig,
} from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { RouterCredentialsService } from './router-credentials.service.js';

interface CachedClient {
  service: IMikrotikService;
  /** Empreinte de la config ayant servi à construire le client. */
  signature: string;
}

/**
 * Fabrique un `IMikrotikService` par routeur enregistré en base (objectif
 * multi-sites). Les identifiants sont déchiffrés à la volée et ne sont jamais
 * conservés en clair au-delà de la construction du client.
 */
@Injectable()
export class MikrotikClientFactory {
  private readonly cache = new Map<string, CachedClient>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: RouterCredentialsService,
    private readonly config: ConfigService,
  ) {}

  async forRouter(routerId: string): Promise<IMikrotikService> {
    const router = await this.prisma.router.findUnique({ where: { id: routerId } });
    if (!router) throw new NotFoundException(`Routeur ${routerId} introuvable`);
    return this.build(router);
  }

  /** Routeur par défaut : le plus ancien enregistré (site unique actuel). */
  async forDefaultRouter(): Promise<IMikrotikService> {
    const router = await this.prisma.router.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!router) {
      throw new NotFoundException('Aucun routeur enregistré — exécuter `npm run seed`');
    }
    return this.build(router);
  }

  async getDefaultRouterId(): Promise<string> {
    const router = await this.prisma.router.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!router) {
      throw new NotFoundException('Aucun routeur enregistré — exécuter `npm run seed`');
    }
    return router.id;
  }

  /** Invalide le cache après modification d'un routeur (hôte, identifiants…). */
  invalidate(routerId: string): void {
    this.cache.delete(routerId);
  }

  /**
   * Construit un client sans passer par la base : utilisé pour tester une
   * connexion avant d'enregistrer le routeur.
   */
  buildFromConfig(config: RouterOSClientConfig, scope = 'mikrotik'): IMikrotikService {
    const logger = new ConsoleLogger(scope);
    return new RouterOSMikrotikService(new RouterOSRestClient(config, logger), logger);
  }

  private build(router: Router): IMikrotikService {
    const signature = `${router.host}:${router.restPort}:${router.credentialsEncrypted}:${router.tlsFingerprint ?? ''}`;
    const cached = this.cache.get(router.id);
    if (cached?.signature === signature) return cached.service;

    const { username, password } = this.credentials.decrypt(router.credentialsEncrypted);
    const service = this.buildFromConfig(
      {
        baseUrl: `https://${router.host}:${router.restPort}`,
        username,
        password,
        tlsFingerprint: router.tlsFingerprint ?? undefined,
        // Sans empreinte épinglée, le certificat auto-signé du routeur ne peut
        // pas être validé par une autorité : on l'accepte explicitement.
        rejectUnauthorized: router.tlsFingerprint
          ? true
          : this.config.get<string>('MIKROTIK_TLS_REJECT_UNAUTHORIZED', 'true') !== 'false',
      },
      `mikrotik:${router.label}`,
    );

    this.cache.set(router.id, { service, signature });
    return service;
  }
}
