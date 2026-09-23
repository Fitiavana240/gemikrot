import {
  BadRequestException,
  ConflictException,
  GoneException,
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
import {
  adressePerimee,
  hoteDeLUrl,
  type AdressePerimee,
} from '../common/adresses-locales.js';

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
  /**
   * L'adresse annoncee au routeur n'est plus celle de cette machine.
   *
   * Constate sur cette installation : le script annoncait `192.168.88.135`,
   * la console repondait sur `.23`. Le routeur a appele dans le vide — et
   * **l'echec est muet** : `/tool/fetch` reste sur << status: connecting >>
   * jusqu'a expiration, sans rien dire de plus. Pire, il bloque le terminal
   * et avale les lignes collees a sa suite, qui reapparaissent tronquees en
   * erreur de syntaxe sans rapport apparent.
   *
   * `null` quand tout va bien, ou quand l'adresse est un nom de domaine :
   * celui-la ne perime pas.
   */
  adressePerimee: AdressePerimee | null;
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
      adressePerimee: this.adresseDeRappelPerimee(),
    };
  }

  /**
   * L'adresse que le script fera appeler existe-t-elle encore ici ?
   *
   * Le seul moment où la question se pose utilement est **avant** de coller le
   * script : une fois collé, le routeur appelle dans le vide et rien ne le
   * dit. `/tool/fetch` reste sur « status: connecting », bloque le terminal,
   * avale les lignes suivantes — et l'exploitant voit une erreur de syntaxe
   * qui n'a aucun rapport avec la cause.
   *
   * Les deux réglages sont vérifiés, car ils pourrissent ensemble : le rappel
   * HTTP (`PUBLIC_BASE_URL`) et le point d'entrée du tunnel
   * (`WIREGUARD_ENDPOINT_HOST`) portent en général la même adresse. On signale
   * le premier qui a bougé.
   */
  private adresseDeRappelPerimee(): AdressePerimee | null {
    const rappel = this.config.get<string>('PUBLIC_BASE_URL');
    const hote = rappel ? hoteDeLUrl(rappel) : '';
    return (
      (hote ? adressePerimee(hote) : null) ??
      adressePerimee(this.wireguard.settings.endpointHost)
    );
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

    if (!enrollment) {
      // Inconnu : 404. Deviner reste hors d'atteinte — 256 bits d'aléa — et
      // c'est aussi ce que voit un script dont l'invitation a été effacée
      // parce qu'elle avait expiré.
      throw new NotFoundException("Jeton d'enrôlement inconnu");
    }

    /**
     * Connu mais périmé ou déjà servi : **410 Gone**, et non 404.
     *
     * Les trois cas rendaient le même refus, pour ne pas les distinguer en
     * tâtonnant. La précaution ne protégeait rien : qui sait qu'un jeton a
     * expiré le détenait déjà. Et elle coûtait cher — `/tool/fetch` n'affiche
     * que le code, l'exploitant lisait « 404 Not Found » sur un routeur où
     * tout s'était pourtant bien passé, et cherchait une faute de frappe dans
     * une adresse qui était juste. Relevé sur ce parc.
     */
    if (enrollment.consumedAt) {
      throw new GoneException(
        "Ce script a déjà servi. Le routeur est raccordé : rien de plus à faire.",
      );
    }
    if (enrollment.expiresAt.getTime() <= Date.now()) {
      throw new GoneException(
        "Ce script a expiré. Préparez-en un nouveau depuis la console et recollez-le : " +
          "le tunnel et le compte déjà posés seront simplement repris.",
      );
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
  /**
   * Publique, parce qu'un second parcours l'emploie.
   *
   * Le raccordement assiste alloue dans le meme sous-reseau. Deux allocateurs
   * pour une seule plage finiraient par donner la meme adresse a deux
   * routeurs — et un tunnel ou deux pairs partagent une adresse ne tombe pas,
   * il livre les paquets au hasard, ce qui est bien pire.
   */
  async allocateAddress(): Promise<string> {
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
# GeMikrot - raccordement de ce routeur au serveur
# A coller dans : Winbox > New Terminal
# Valable 30 minutes. Passe ce delai, regenerer depuis la console.
#
# Sans accent, et ce n'est pas une negligence : le terminal Winbox rend les
# caracteres accentues en mojibake selon la police installee. Un commentaire
# illisible fait douter du reste du script, au moment precis ou l'on demande
# a quelqu'un de coller des commandes sur son materiel en production.
#
# Rejouable : chaque etape efface d'abord ce qu'un essai precedent aurait
# laisse. Sans cela, une seconde execution rend un mur de
# << failure: already have... >> ou rien ne distingue l'echec attendu de
# l'echec veritable.
# ============================================================

# 1. Le tunnel. La cle privee est creee ici et ne quitte jamais ce routeur.
/interface/wireguard/remove [find name=${WG_INTERFACE}]
/interface/wireguard/add name=${WG_INTERFACE} listen-port=13231 comment="GeMikrot"
/ip/address/remove [find interface=${WG_INTERFACE}]
/ip/address/add address=${params.tunnelAddress}/32 interface=${WG_INTERFACE} comment="GeMikrot"
# Une adresse en /32 ne cree aucune route : sans celle-ci, ce routeur saurait
# recevoir les appels du serveur mais pas lui repondre.
/ip/route/remove [find comment="GeMikrot"]
/ip/route/add dst-address=${subnet} gateway=${WG_INTERFACE} comment="GeMikrot"

# 2. Le serveur, comme pair. C'est ce routeur qui appelle, jamais l'inverse :
#    aucun port a ouvrir, aucune adresse fixe necessaire cote routeur.
/interface/wireguard/peers/remove [find comment="GeMikrot"]
/interface/wireguard/peers/add interface=${WG_INTERFACE} \\
    public-key="${publicKey}" \\
    endpoint-address=${endpointHost} endpoint-port=${endpointPort} \\
    allowed-address=${subnet} \\
    persistent-keepalive=25 comment="GeMikrot"

# 3. Un compte dedie a l'application, aux droits limites. Jamais << admin >>.
#    Le compte part avant son groupe : RouterOS refuse de retirer un groupe
#    dont un utilisateur depend encore.
/user/remove [find name=${API_USERNAME}]
/user/group/remove [find name=gemikrot]
/user/group/add name=gemikrot policy=read,write,api,rest-api,test \\
    comment="GeMikrot - lecture/ecriture HotSpot et User Manager"
/user/add name=${API_USERNAME} group=gemikrot password="${params.apiPassword}" \\
    comment="GeMikrot - compte applicatif"

# Ce script ne touche PAS au service www-ssl, volontairement. Restreindre
# l'API avant d'avoir eprouve le tunnel a deja coupe un routeur en essai :
# << set www-ssl address=... >> REMPLACE la liste, et la forme censee y ajouter
# une entree l'a effacee a la place. Le resserrage est une etape separee, que
# la console propose une fois le tunnel constate - et qui, a ce moment-la,
# peut etre annulee par le tunnel lui-meme.

:put "Tunnel et compte poses. Envoi de la cle publique au serveur..."

# 4. On previent le serveur, en lui donnant la cle publique de ce routeur.
#
#    **En dernier, et rien apres.** /tool/fetch bloque le terminal le temps de
#    sa tentative. Si l'adresse ci-dessous n'est plus la bonne, il reste sur
#    << status: connecting >> et **avale les lignes collees a sa suite**, qui
#    reapparaissent tronquees en erreur de syntaxe. On cherche alors un defaut
#    de script la ou il n'y a qu'une adresse perimee.
#
#    **Si vous lisez << Status 404 >> ou << Status 410 >> ci-dessous**, le
#    script est perime : il ne vaut que 30 minutes, et preparer un nouveau
#    script annule le precedent. Le tunnel et le compte sont bien poses sur ce
#    routeur, il ne manque que l'avis au serveur : regenerez un script depuis
#    la console et recollez-le, rien ne sera fait en double.
#
#    Tout est calcule dans la commande elle-meme : collees une par une dans le
#    terminal, des lignes << :local >> ne se voient pas l'une l'autre, et la
#    valeur arriverait vide sans que rien ne le signale.
/tool/fetch url="${callbackUrl}" http-method=post http-header-field="Content-Type:application/json" http-data=("{\\"publicKey\\":\\"" . [/interface/wireguard/get [find name=${WG_INTERFACE}] public-key] . "\\",\\"identity\\":\\"" . [/system/identity/get name] . "\\"}") output=none
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
