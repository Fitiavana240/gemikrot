import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
import { RouterHealthService, RouterUnreachableException } from './router-health.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';

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
    private readonly health: RouterHealthService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Le materiel d'un exploitant n'appartient qu'a lui.
   *
   * Le SUPER_ADMIN peut se placer sur un exploitant pour l'aider -- regler sa
   * marque, lire son abonnement, nettoyer une fiche restee d'un essai. Mais
   * **ouvrir une connexion vers son routeur est d'une autre nature** : c'est
   * entrer chez lui, voir ses clients connectes, lire ses comptes HotSpot,
   * ecrire dans sa configuration. Rien dans la gestion d'une plateforme ne
   * l'exige, et la possibilite seule suffit a rendre la promesse fausse.
   *
   * `priseEnMain` marque exactement ce cas : un SUPER_ADMIN agissant au nom
   * d'un exploitant. Hors requete HTTP -- travaux de fond, file d'operations
   * differees -- il est absent, et les travaux passent : ils agissent pour
   * l'exploitant, pas pour quelqu'un.
   */
  private refuserSiPriseEnMain(label: string): void {
    if (this.tenantContext.get()?.priseEnMain !== true) return;
    throw new ForbiddenException(
      `Le routeur << ${label} >> appartient a son exploitant : la plateforme ne s'y connecte pas. ` +
        `Vous pouvez gerer son abonnement et sa fiche, pas son materiel.`,
    );
  }

  async forRouter(routerId: string): Promise<IMikrotikService> {
    const router = await this.prisma.scoped.router.findUnique({ where: { id: routerId } });
    if (!router) throw new NotFoundException(`Routeur ${routerId} introuvable`);
    return this.build(router);
  }

  /** Routeur par défaut : le plus ancien enregistré (site unique actuel). */
  async forDefaultRouter(): Promise<IMikrotikService> {
    const router = await this.prisma.scoped.router.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!router) {
      throw new NotFoundException('Aucun routeur enregistré — exécuter `npm run seed`');
    }
    return this.build(router);
  }

  async getDefaultRouterId(): Promise<string> {
    const router = await this.prisma.scoped.router.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!router) {
      throw new NotFoundException('Aucun routeur enregistré — exécuter `npm run seed`');
    }
    return router.id;
  }

  /**
   * Par quelle adresse la console a joint ce routeur, pour le dire à l'écran.
   *
   * L'exploitant n'a qu'une question quand il parle de VPN : « est-ce que ça
   * passe par là ? » Sans cette réponse, le tunnel reste une promesse
   * invérifiable — il peut tourner sur le routeur sans qu'un seul appel de la
   * console l'emprunte.
   */
  async cheminVers(routerId: string): Promise<{ hôte: string; parLeTunnel: boolean }> {
    const router = await this.prisma.scoped.router.findUniqueOrThrow({ where: { id: routerId } });
    return MikrotikClientFactory.adresseDuRouteur(router);
  }

  /** Invalide le cache après modification d'un routeur (hôte, identifiants…). */
  invalidate(routerId: string): void {
    this.cache.delete(routerId);
    // Les identifiants ou l'adresse ont changé : l'état de santé observé
    // portait sur l'ancienne configuration et n'a plus de sens.
    this.health.reset(routerId);
  }

  /**
   * Construit un client sans passer par la base : utilisé pour tester une
   * connexion avant d'enregistrer le routeur.
   */
  buildFromConfig(config: RouterOSClientConfig, scope = 'mikrotik'): IMikrotikService {
    const logger = new ConsoleLogger(scope);
    return new RouterOSMikrotikService(new RouterOSRestClient(config, logger), logger);
  }

  /**
   * Par quelle adresse joindre ce routeur.
   *
   * **Le tunnel d'abord, quand il existe.** Un routeur enrôlé a reçu une
   * adresse `10.88.x.y` dans le tunnel, et son service REST n'écoute souvent
   * plus que là — le script d'enrôlement restreint `www-ssl` à la seule
   * adresse du serveur. Son `host` d'origine, lui, est une adresse de réseau
   * local qui ne veut rien dire depuis ailleurs.
   *
   * La colonne existait et l'enrôlement la remplissait, mais **personne ne la
   * lisait** : la fabrique composait toujours `https://${host}`. L'accès à
   * distance ne pouvait donc pas fonctionner, quel que soit l'état du tunnel.
   *
   * `enrolledAt` décide, et non la seule présence d'une adresse : une adresse
   * réservée pour une invitation jamais aboutie ne doit pas détourner les
   * appels vers un tunnel qui n'existe pas.
   */
  static adresseDuRouteur(router: Router): { hôte: string; parLeTunnel: boolean } {
    if (router.enrolledAt && router.tunnelAddress) {
      return { hôte: router.tunnelAddress, parLeTunnel: true };
    }
    return { hôte: router.host, parLeTunnel: false };
  }

  private build(router: Router): IMikrotikService {
    this.refuserSiPriseEnMain(router.label);
    const { hôte } = MikrotikClientFactory.adresseDuRouteur(router);
    // L'adresse entre dans la signature : basculer sur le tunnel doit
    // reconstruire le client, pas resservir celui qui visait le réseau local.
    const signature = `${hôte}:${router.restPort}:${router.credentialsEncrypted}:${router.tlsFingerprint ?? ''}`;
    const cached = this.cache.get(router.id);
    if (cached?.signature === signature) return cached.service;

    const { username, password } = this.credentials.decrypt(router.credentialsEncrypted);
    const service = this.buildFromConfig(
      {
        baseUrl: `https://${hôte}:${router.restPort}`,
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

    const guarded = this.withCircuitBreaker(service, router);
    this.cache.set(router.id, { service: guarded, signature });
    return guarded;
  }

  /**
   * Enveloppe le service pour que chaque appel passe par le disjoncteur.
   *
   * Un proxy plutôt qu'une classe de délégation : l'interface porte une
   * quarantaine de méthodes, toutes asynchrones, et une classe intermédiaire
   * devrait être tenue à jour à chaque ajout — elle finirait par diverger.
   */
  private withCircuitBreaker(service: IMikrotikService, router: Router): IMikrotikService {
    const health = this.health;

    return new Proxy(service, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;

        return async (...args: unknown[]) => {
          // `autoriserAppel` et non `blockedReason` : c'est ici qu'on appelle
          // vraiment, donc ici qu'on prend la place de sonde quand le repos
          // vient de finir. La forme qui ne fait que lire ne la prend pas.
          const blocked = health.autoriserAppel(router.id);
          if (blocked) {
            // Échec immédiat : inutile de repayer le budget complet de
            // délais sur un routeur dont on sait qu'il ne répond pas.
            throw new RouterUnreachableException(router.label, blocked);
          }

          try {
            const result = await (value as (...a: unknown[]) => unknown).apply(target, args);
            health.recordSuccess(router.id);
            return result;
          } catch (error) {
            health.recordFailure(router.id, error);
            throw error;
          }
        };
      },
    });
  }
}
