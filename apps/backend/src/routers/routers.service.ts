import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { WireguardService } from './wireguard.service.js';
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
    private readonly wireguard: WireguardService,
  ) {}

  private readonly logger = new Logger(RoutersService.name);

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

  /**
   * Retire un routeur de la console.
   *
   * **Refuse tant que quelque chose y est attache**, et dit quoi. Un routeur
   * porte les abonnements, les appareils, les lots de tickets et le journal
   * d'un exploitant : les emporter d'un clic serait irreversible et muet. Une
   * configuration d'essai qui n'a pas abouti, elle, ne porte rien -- c'est le
   * cas courant, et celui qu'il faut rendre facile.
   *
   * **N'ecrit rien sur le routeur.** Le tunnel, le compte applicatif et le
   * certificat poses par le script y restent : la console ne le joint peut-etre
   * plus, et effacer a distance une configuration qu'on ne voit pas serait pire
   * que la laisser. Rejouer le script les reprendra.
   */
  async supprimer(id: string, adminUserId?: string): Promise<{ supprime: true }> {
    const routeur = await this.requireRouter(id);
    const attaches = await this.ceQuiEstAttache(id);

    if (attaches.length > 0) {
      throw new ConflictException(
        `Ce routeur porte encore ${attaches.join(', ')}. ` +
          `Supprimez-les d'abord : les emporter avec lui serait irreversible.`,
      );
    }

    // Le pair part avec la fiche. Le laisser derriere garderait ouverte, dans
    // le tunnel, une route vers un routeur que la console ne connait plus.
    await this.wireguard.removePeer(routeur.tunnelPublicKey ?? '').catch((error: unknown) => {
      this.logger.warn(`Pair non retire pour ${routeur.label} : ${String(error)}`);
    });

    // Hors cloisonnement, et pour deux raisons. Le routeur a deja ete resolu
    // par le client cloisonne juste au-dessus, donc l'appelant y a droit. Et
    // `$transaction` d'un tableau attend des promesses du client de base :
    // celles du client etendu ne s'y composent pas, et ce qui suit doit
    // partir d'un seul bloc -- une fiche a moitie effacee laisserait des
    // caches orphelins qu'aucun ecran ne montre.
    await this.prisma.$transaction([
      // Hors cloisonnement : voir ci-dessus, pour ce bloc entier.
      this.prisma.routerEnrollment.deleteMany({ where: { routerId: id } }),
      this.prisma.userCacheEntry.deleteMany({ where: { routerId: id } }),
      this.prisma.sessionCacheEntry.deleteMany({ where: { routerId: id } }),
      this.prisma.statsCacheEntry.deleteMany({ where: { routerId: id } }),
      // Le journal survit a la fiche : c'est la trace de ce qui a ete fait,
      // et elle doit rester lisible apres coup.
      this.prisma.auditLog.updateMany({ where: { routerId: id }, data: { routerId: null } }),
      // Hors cloisonnement : meme raison, et la fiche part en dernier -- les
      // lignes qui la referencent doivent avoir disparu avant.
      this.prisma.router.delete({ where: { id } }),
    ]);

    this.clients.invalidate(id);
    await this.audit.log({
      adminUserId,
      action: 'DELETE_ROUTER',
      targetType: 'Router',
      targetId: id,
      payloadDiff: { label: routeur.label, host: routeur.host },
    });
    this.logger.log(`Routeur << ${routeur.label} >> supprime de la console`);
    return { supprime: true };
  }

  /**
   * Reecrit le pair de ce routeur dans le fichier du tunnel, depuis sa fiche.
   *
   * Le fichier peut diverger de la fiche -- un second raccordement interrompu,
   * un outil qui repasse derriere, une sauvegarde restauree. Jusqu'ici la
   * seule facon de le remettre d'aplomb etait de refaire tout le
   * raccordement, ou de l'editer a la main : la premiere fait perdre du
   * temps, la seconde a deja coute la cle privee du serveur et deux lignes
   * d'interface.
   *
   * N'ecrit rien sur le routeur : la fiche est la source, et le routeur porte
   * deja ce qu'il faut.
   */
  async reecrireLePair(id: string): Promise<{ ecrit: boolean; message: string }> {
    const routeur = await this.requireRouter(id);

    if (!routeur.tunnelPublicKey || !routeur.tunnelAddress) {
      throw new ConflictException(
        `« ${routeur.label} » n'a pas de clé de tunnel : il n'a jamais été raccordé. ` +
          `Passez par « Préparer un script à coller ».`,
      );
    }

    // Sans adresse d'appel : c'est le routeur qui appelle.
    const r = await this.wireguard.addPeer(
      { publicKey: routeur.tunnelPublicKey, tunnelAddress: routeur.tunnelAddress },
      routeur.label,
    );

    await this.audit.log({
      action: 'REWRITE_TUNNEL_PEER',
      targetType: 'Router',
      targetId: id,
      routerId: id,
      payloadDiff: { tunnelAddress: routeur.tunnelAddress, endpoint: routeur.tunnelEndpoint },
    });

    if (!r.ecritDansLeFichier) {
      return {
        ecrit: false,
        message:
          `Le serveur n'a pas pu écrire le fichier du tunnel. ` +
          `À passer à la main : ${r.command}`,
      };
    }
    return {
      ecrit: true,
      message:
        `Pair réécrit pour ${routeur.tunnelAddress}. ` +
        `Rechargez le tunnel dans l'application WireGuard — elle garde sa propre copie ` +
        `du fichier depuis l'import et ne le relit pas d'elle-même. ` +
        `C'est ensuite le routeur qui appelle : le tunnel montera de lui-même.`,
    };
  }

  /** Ce qui disparaitrait avec ce routeur, en clair et au pluriel juste. */
  private async ceQuiEstAttache(id: string): Promise<string[]> {
    // Hors cloisonnement : le compte est fait pour un routeur deja resolu par
    // le client cloisonne, et il doit voir *tout* ce qui y pend -- une ligne
    // invisible au cloisonnement serait une suppression en cascade silencieuse.
    const [abonnements, appareils, lots, operations] = await Promise.all([
      this.prisma.subscription.count({ where: { routerId: id } }),
      this.prisma.device.count({ where: { routerId: id } }),
      this.prisma.voucherBatch.count({ where: { routerId: id } }),
      // Hors cloisonnement : meme raison que les trois comptes ci-dessus.
      this.prisma.routerOperation.count({ where: { routerId: id, status: 'EN_ATTENTE' } }),
    ]);

    const parties: string[] = [];
    const ajouter = (nombre: number, singulier: string, pluriel: string) => {
      if (nombre > 0) parties.push(`${nombre} ${nombre > 1 ? pluriel : singulier}`);
    };
    ajouter(abonnements, 'abonnement', 'abonnements');
    ajouter(appareils, 'appareil', 'appareils');
    ajouter(lots, 'lot de tickets', 'lots de tickets');
    ajouter(operations, 'operation en attente', 'operations en attente');
    return parties;
  }

  private async requireRouter(id: string): Promise<Router> {
    const router = await this.prisma.scoped.router.findUnique({ where: { id } });
    if (!router) throw new NotFoundException(`Routeur ${id} introuvable`);
    return router;
  }
}
