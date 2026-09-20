import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { RouterCredentialsService } from './router-credentials.service.js';
import { WireguardService } from './wireguard.service.js';

/** Durée de vie du jeton. Assez pour aller au routeur, trop court pour traîner. */
const TOKEN_TTL_MS = 30 * 60 * 1000;
/** Nom du compte d'API dédié créé sur le routeur. Jamais `admin`. */
const API_USERNAME = 'gemikrot-api';
const WG_INTERFACE = 'gemikrot';

export interface EnrollmentInvitation {
  id: string;
  label: string;
  tunnelAddress: string;
  expiresAt: Date;
  /** Le script à coller dans le terminal Winbox. Contient le jeton et le mot
   *  de passe en clair : il n'est rendu qu'à cette création, jamais relu. */
  script: string;
  /**
   * L'adresse que le routeur appellera, et si elle est privée.
   *
   * Une adresse privée ne se joint que depuis le même réseau. Le script est
   * alors bon pour un essai en local et inutilisable ailleurs — et l'échec
   * est muet côté routeur.
   */
  endpoint: string;
  endpointPrive: boolean;
}

@Injectable()
export class RouterEnrollmentService {
  private readonly logger = new Logger(RouterEnrollmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: RouterCredentialsService,
    private readonly wireguard: WireguardService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Prépare un enrôlement et rend le script à coller.
   *
   * Rien n'est écrit sur le routeur depuis ici, et rien ne peut l'être : le
   * serveur ne le connaît pas encore. C'est l'exploitant qui exécute, ce qui
   * a un effet secondaire souhaitable — il voit exactement ce qui sera fait
   * sur son matériel.
   */
  async invite(label: string): Promise<EnrollmentInvitation> {
    const missing = this.wireguard.missingConfiguration();
    if (missing.length > 0) {
      throw new BadRequestException(
        `Tunnel non configuré sur le serveur : ${missing.join(', ')} manquant(s). ` +
          "L'enrôlement d'un routeur distant suppose un serveur joignable.",
      );
    }

    const tenantId = this.tenantContext.requireTenantId();
    const tunnelAddress = await this.allocateAddress();

    // Le mot de passe d'API est produit ici plutôt que sur le routeur :
    // RouterOS n'offre pas d'aléa digne de ce nom en script, et le serveur
    // doit de toute façon le connaître pour s'en servir.
    const apiPassword = randomBytes(24).toString('base64url');
    const token = randomBytes(32).toString('base64url');

    const enrollment = await this.prisma.scopedStrict.routerEnrollment.create({
      data: {
        tenantId,
        label,
        tokenHash: hashToken(token),
        tunnelAddress,
        credentialsEncrypted: this.credentials.encrypt({
          username: API_USERNAME,
          password: apiPassword,
        }),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });

    return {
      id: enrollment.id,
      label,
      tunnelAddress,
      expiresAt: enrollment.expiresAt,
      script: this.buildScript({ token, apiPassword, tunnelAddress }),
      endpoint: `${this.wireguard.settings.endpointHost}:${this.wireguard.settings.endpointPort}`,
      endpointPrive: this.wireguard.endpointPrive,
    };
  }

  /**
   * Retire une invitation qu'on ne compte plus servir.
   *
   * Un script préparé par erreur — mauvais nom, changement d'avis — restait
   * sinon trente minutes dans la liste, son adresse de tunnel réservée avec.
   *
   * Seulement ce qui n'a jamais abouti : une invitation consommée a produit
   * un routeur, et la supprimer effacerait la trace de son raccordement.
   */
  async cancel(id: string): Promise<void> {
    const invitation = await this.prisma.scopedStrict.routerEnrollment.findUnique({
      where: { id },
    });
    if (!invitation) throw new NotFoundException(`Invitation ${id} introuvable`);
    if (invitation.consumedAt) {
      throw new BadRequestException(
        `L'invitation « ${invitation.label} » a déjà servi : le routeur est raccordé.`,
      );
    }

    await this.prisma.scopedStrict.routerEnrollment.delete({ where: { id } });
    this.logger.log(`Invitation annulée : ${invitation.label}`);
  }

  /** Les invitations encore ouvertes, pour que l'exploitant s'y retrouve. */
  pending() {
    return this.prisma.scopedStrict.routerEnrollment.findMany({
      where: { consumedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, label: true, tunnelAddress: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Rappel du routeur, une fois le script exécuté.
   *
   * **Sans jeton d'application** : le routeur n'a pas de session, il n'en
   * aura jamais. Le jeton d'enrôlement tient lieu d'authentification — d'où
   * son entropie, sa durée de vie courte, son usage unique, et le fait qu'il
   * ne soit stocké que haché.
   *
   * L'appelant n'est pas dans un contexte d'exploitant : il est déterminé par
   * le jeton, et tout ce qui suit s'exécute dedans.
   */
  async consume(
    token: string,
    body: { publicKey: string; identity?: string },
  ): Promise<{ routerId: string; tunnelAddress: string; peerApplied: boolean }> {
    const enrollment = await this.prisma.routerEnrollment.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    // Un jeton inconnu, déjà servi ou périmé donnent la même réponse : rien
    // ne doit permettre de distinguer les trois en tâtonnant.
    if (!enrollment || enrollment.consumedAt || enrollment.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException("Jeton d'enrôlement inconnu ou expiré");
    }

    if (!/^[A-Za-z0-9+/]{42}[A-Za-z0-9+/=]{2}$/.test(body.publicKey)) {
      throw new BadRequestException('Clé publique WireGuard invalide');
    }

    return this.tenantContext.runAsTenant(enrollment.tenantId, async () => {
      // Le jeton est brûlé avant tout le reste : deux exécutions du script
      // ne doivent pas créer deux routeurs sur la même adresse.
      const burnt = await this.prisma.scopedStrict.routerEnrollment.updateMany({
        where: { id: enrollment.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (burnt.count === 0) {
        throw new ConflictException("Jeton d'enrôlement déjà utilisé");
      }

      const router = await this.prisma.scopedStrict.router.create({
        data: {
          tenantId: enrollment.tenantId,
          label: body.identity?.trim() || enrollment.label,
          // L'adresse du tunnel devient l'hôte : c'est par là que le serveur
          // joindra ce routeur. L'accès direct reste ouvert tant que
          // l'exploitant ne l'a pas resserré, une fois le tunnel constaté.
          host: enrollment.tunnelAddress,
          restPort: 443,
          credentialsEncrypted: enrollment.credentialsEncrypted,
          tunnelAddress: enrollment.tunnelAddress,
          tunnelPublicKey: body.publicKey,
          enrolledAt: new Date(),
          status: 'enrolled',
        },
      });

      await this.prisma.scopedStrict.routerEnrollment.update({
        where: { id: enrollment.id },
        data: { routerId: router.id },
      });

      const peer = await this.wireguard.addPeer({
        publicKey: body.publicKey,
        tunnelAddress: enrollment.tunnelAddress,
      });

      this.logger.log(
        `Routeur « ${router.label} » enrôlé sur ${enrollment.tunnelAddress}` +
          (peer.applied ? '' : ' — pair WireGuard à ajouter à la main sur le serveur'),
      );

      // Le certificat n'est pas épinglé ici : le routeur vient seulement
      // d'ouvrir le tunnel, et l'empreinte se relève depuis le serveur avec
      // le point d'entrée existant. Un routeur non épinglé est signalé dans
      // la console.
      return {
        routerId: router.id,
        tunnelAddress: enrollment.tunnelAddress,
        peerApplied: peer.applied,
      };
    });
  }

  /**
   * Alloue la première adresse libre du tunnel.
   *
   * Lecture volontairement **non cloisonnée** : le plan d'adressage est
   * commun à tous les exploitants, et attribuer deux fois la même adresse
   * rendrait deux routeurs injoignables. Seules des adresses sont lues, aucune
   * donnée d'exploitant.
   */
  private async allocateAddress(): Promise<string> {
    const { subnet, serverAddress } = this.wireguard.settings;
    const [base, maskRaw] = subnet.split('/');
    const mask = Number(maskRaw);
    const baseParts = base.split('.').map(Number);
    if (baseParts.length !== 4 || baseParts.some(Number.isNaN) || mask < 8 || mask > 30) {
      throw new BadRequestException(`WIREGUARD_SUBNET invalide : ${subnet}`);
    }

    // Une invitation périmée et jamais servie garde son adresse verrouillée
    // par l'index d'unicité tout en étant comptée comme libre plus bas : sans
    // ce nettoyage, réattribuer l'adresse échoue en base. Portée étroite —
    // seulement ce qui a expiré sans jamais avoir abouti.
    await this.prisma.routerEnrollment.deleteMany({
      where: { consumedAt: null, expiresAt: { lte: new Date() } },
    });

    const [routers, invitations] = await Promise.all([
      this.prisma.router.findMany({
        where: { tunnelAddress: { not: null } },
        select: { tunnelAddress: true },
      }),
      this.prisma.routerEnrollment.findMany({
        // Une invitation périmée libère son adresse : sans quoi chaque essai
        // abandonné grignoterait le plan d'adressage.
        where: { consumedAt: null, expiresAt: { gt: new Date() } },
        select: { tunnelAddress: true },
      }),
    ]);

    const taken = new Set<string>([
      serverAddress,
      ...routers.map((r) => r.tunnelAddress!),
      ...invitations.map((e) => e.tunnelAddress),
    ]);

    const network = toInt(baseParts) & (mask === 0 ? 0 : (-1 << (32 - mask)) >>> 0);
    const size = 2 ** (32 - mask);

    // On saute l'adresse de réseau et celle de diffusion.
    for (let offset = 1; offset < size - 1; offset += 1) {
      const candidate = toDotted((network + offset) >>> 0);
      if (!taken.has(candidate)) return candidate;
    }
    throw new ConflictException(`Plus aucune adresse libre dans ${subnet}`);
  }

  /**
   * Le script à coller dans le terminal Winbox.
   *
   * Chaque ligne est commentée en français parce qu'un exploitant doit
   * pouvoir lire ce qu'il exécute sur son propre matériel avant de le faire.
   *
   * Chaque nom de propriété a été confronté à la documentation RouterOS v7 :
   * les propriétés des pairs (`endpoint-address`, `allowed-address`,
   * `persistent-keepalive`), `output=none` de `/tool/fetch`, la forme de
   * l'en-tête HTTP, les politiques de groupe (`rest-api` en est bien une), et
   * `public-key` comme propriété en lecture seule de l'interface.
   *
   * Deux points restent à éprouver sur un routeur réel, et ne peuvent pas
   * l'être autrement : que les politiques retenues suffisent réellement à
   * l'API REST, et que l'ensemble s'exécute d'une traite. Ce projet a déjà
   * retenu quatre erreurs écrites de bonne foi sur la documentation seule.
   */
  private buildScript(params: {
    token: string;
    apiPassword: string;
    tunnelAddress: string;
  }): string {
    const { endpointHost, endpointPort, publicKey, subnet } = this.wireguard.settings;
    const callbackUrl = `${this.config.get<string>('PUBLIC_BASE_URL') ?? `https://${endpointHost}`}/router-enrollments/callback/${params.token}`;

    return `# ============================================================
# GeMikrot — raccordement de ce routeur au serveur
# À coller dans : Winbox > New Terminal
# Valable 30 minutes. Passé ce délai, regénérer depuis la console.
# ============================================================

# 1. Le tunnel. La clé privée est créée ici et ne quitte jamais ce routeur.
/interface/wireguard/add name=${WG_INTERFACE} listen-port=13231 comment="GeMikrot"
/ip/address/add address=${params.tunnelAddress}/32 interface=${WG_INTERFACE} comment="GeMikrot"
# Une adresse en /32 ne crée aucune route : sans celle-ci, ce routeur saurait
# recevoir les appels du serveur mais pas lui répondre.
/ip/route/add dst-address=${subnet} gateway=${WG_INTERFACE} comment="GeMikrot"

# 2. Le serveur, comme pair. C'est ce routeur qui appelle, jamais l'inverse :
#    aucun port à ouvrir, aucune adresse fixe nécessaire côté routeur.
/interface/wireguard/peers/add interface=${WG_INTERFACE} \\
    public-key="${publicKey}" \\
    endpoint-address=${endpointHost} endpoint-port=${endpointPort} \\
    allowed-address=${subnet} \\
    persistent-keepalive=25 comment="GeMikrot"

# 3. Un compte dédié à l'application, aux droits limités. Jamais « admin ».
/user/group/add name=gemikrot policy=read,write,api,rest-api,test \\
    comment="GeMikrot — lecture/écriture HotSpot et User Manager"
/user/add name=${API_USERNAME} group=gemikrot password="${params.apiPassword}" \\
    comment="GeMikrot — compte applicatif"

# 4. On prévient le serveur, en lui donnant la clé publique de ce routeur.
#    Tout est calculé dans la commande elle-même : collées une par une dans le
#    terminal, des lignes « :local » ne se voient pas l'une l'autre, et la valeur
#    arriverait vide sans que rien ne le signale.
/tool/fetch url="${callbackUrl}" http-method=post http-header-field="Content-Type:application/json" http-data=("{\\"publicKey\\":\\"" . [/interface/wireguard/get [find name=${WG_INTERFACE}] public-key] . "\\",\\"identity\\":\\"" . [/system/identity/get name] . "\\"}") output=none

:put "Raccordement envoye. L'acces a l'API reste inchange : il ne sera"
:put "restreint au tunnel qu'une fois celui-ci verifie, depuis la console."

# Ce script ne touche PAS au service www-ssl, volontairement. Restreindre
# l'API avant d'avoir éprouvé le tunnel a déjà coupé un routeur en essai :
# « set www-ssl address=... » REMPLACE la liste, et la forme censée y ajouter
# une entrée l'a effacée à la place. Le resserrage est une étape séparée, que
# la console propose une fois le tunnel constaté — et qui, à ce moment-là,
# peut être annulée par le tunnel lui-même.
`;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toInt(parts: number[]): number {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function toDotted(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}
