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

/**
 * L'etat du serveur de tunnel, vu de la console.
 *
 * Le pair se pose sur le routeur, et le routeur se met a appeler. Si personne
 * n'ecoute en face, **rien ne le dit** : WireGuard n'a pas d'erreur, les
 * octets sortants montent, les entrants restent a zero. La consigne partait
 * dans un avertissement de journal que personne ne lit.
 */
export interface EtatServeurTunnel {
  endpoint: string;
  /** Une adresse privee ne se joint que depuis le meme reseau. */
  endpointPrive: boolean;
  /** La console applique-t-elle elle-meme les pairs sur le serveur ? */
  pilote: boolean;
  /** Le nom de l'interface cote serveur, pour les commandes a passer. */
  interfaceName: string;
  /** Ce qui empeche un routeur distant de joindre ce serveur, en clair. */
  manques: string[];
  /** Les pairs a poser a la main, faute de pilotage. */
  pairs: { label: string; commande: string }[];
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

  /**
   * Ce qui manque pour qu'un routeur distant atteigne ce serveur.
   *
   * Trois choses peuvent manquer, et elles se cumulent en silence :
   *
   * 1. **Personne n'ecoute.** `WIREGUARD_MANAGED` a faux, la console ne pose
   *    aucun pair sur le serveur. Le routeur appelle dans le vide.
   * 2. **L'adresse est privee.** Un routeur situe ailleurs ne joindra jamais
   *    un `192.168.x.y`, quoi qu'on configure par ailleurs.
   * 3. **La cle du serveur manque**, et le routeur n'a personne a qui parler.
   *
   * Les commandes des pairs sont rendues telles quelles : quand la console ne
   * pilote pas le serveur, c'est la seule facon d'y arriver.
   */
  async etatDuServeur(): Promise<EtatServeurTunnel> {
    const { endpointHost, endpointPort, interfaceName } = this.wireguard.settings;
    const pilote = this.wireguard.settings.managed;
    const prive = this.wireguard.endpointPrive;

    const manques: string[] = [];
    for (const absent of this.wireguard.missingConfiguration()) {
      manques.push(`${absent} n'est pas renseigne dans le fichier .env du serveur.`);
    }
    if (!pilote) {
      manques.push(
        "La console ne pose pas les pairs sur le serveur (WIREGUARD_MANAGED n'est pas a " +
          '« true »). Chaque routeur raccorde doit etre ajoute a la main, avec la commande ' +
          'donnee ci-dessous.',
      );
    }
    if (prive) {
      manques.push(
        `L'adresse annoncee aux routeurs, ${endpointHost}, est une adresse privee : ` +
          "elle ne se joint que depuis ce reseau. Un routeur situe ailleurs ne l'atteindra " +
          'jamais. Pour du distant, le serveur doit avoir une adresse publique ou une ' +
          'redirection de port.',
      );
    }

    // Seuls les routeurs qui ont une cle : les autres ne sont pas dans le
    // tunnel, et proposer une commande pour eux n'aurait pas de sens.
    const routeurs = await this.prisma.scopedStrict.router.findMany({
      where: { tunnelPublicKey: { not: null }, tunnelAddress: { not: null } },
      select: { label: true, tunnelPublicKey: true, tunnelAddress: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      endpoint: `${endpointHost}:${endpointPort}`,
      endpointPrive: prive,
      pilote,
      interfaceName,
      manques,
      pairs: routeurs.map((r) => ({
        label: r.label,
        commande: `wg set ${interfaceName} peer ${r.tunnelPublicKey} allowed-ips ${r.tunnelAddress}/32`,
      })),
    };
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
#
# Les retraits sont ecrits << :do { ... } on-error={} >>, et cette forme fait
# deux choses a la fois : elle avale l'echec quand il n'y a rien a retirer -
# sur un routeur vierge, c'est le cas de tous - et elle met la commande entre
# accolades, ou le terminal n'execute rien avant l'accolade fermante. Un
# collage ne peut donc pas l'interrompre a mi-chemin.
#
# Ce script pose quatre choses : le tunnel, un compte applicatif aux droits
# limites, un certificat pour l'API, puis il previent le serveur. Il ne touche
# ni a votre compte admin, ni au HotSpot, ni a vos clients.
# ============================================================

# 1. Le tunnel. La cle privee est creee ici et ne quitte jamais ce routeur.
:do { /interface/wireguard/remove [find name=${WG_INTERFACE}] } on-error={}
/interface/wireguard/add name=${WG_INTERFACE} listen-port=13231 comment="GeMikrot"
:do { /ip/address/remove [find interface=${WG_INTERFACE}] } on-error={}
/ip/address/add address=${params.tunnelAddress}/32 interface=${WG_INTERFACE} comment="GeMikrot"
# Une adresse en /32 ne cree aucune route : sans celle-ci, ce routeur saurait
# recevoir les appels du serveur mais pas lui repondre.
:do { /ip/route/remove [find comment="GeMikrot"] } on-error={}
/ip/route/add dst-address=${subnet} gateway=${WG_INTERFACE} comment="GeMikrot"

# 2. Le serveur, comme pair. C'est ce routeur qui appelle, jamais l'inverse :
#    aucun port a ouvrir, aucune adresse fixe necessaire cote routeur.
:do { /interface/wireguard/peers/remove [find comment="GeMikrot"] } on-error={}
/interface/wireguard/peers/add interface=${WG_INTERFACE} \\
    public-key="${publicKey}" \\
    endpoint-address=${endpointHost} endpoint-port=${endpointPort} \\
    allowed-address=${subnet} \\
    persistent-keepalive=25 comment="GeMikrot"

# 3. Un compte dedie a l'application, aux droits limites. Jamais << admin >>.
#    Le compte part avant son groupe : RouterOS refuse de retirer un groupe
#    dont un utilisateur depend encore.
:do { /user/remove [find name=${API_USERNAME}] } on-error={}
:do { /user/group/remove [find name=gemikrot] } on-error={}
/user/group/add name=gemikrot policy=read,write,api,rest-api,test \\
    comment="GeMikrot - lecture/ecriture HotSpot et User Manager"
/user/add name=${API_USERNAME} group=gemikrot password="${params.apiPassword}" \\
    comment="GeMikrot - compte applicatif"

# 4. Le certificat de l'API, sans lequel la console ne peut pas parler.
#
#    La console dialogue en REST sur https : il faut donc que << www-ssl >>
#    presente un certificat valide. Un routeur qui n'en a pas accepte la
#    connexion puis la coupe net, **sans un mot d'explication** - ni dans le
#    journal du routeur, ni cote console. Constate sur ce parc : api-ssl
#    repondait << handshake_failure >> et www-ssl coupait sechement, les deux
#    pour la meme raison.
#
#    La cause la plus frequente est l'horloge. Apres une coupure de courant,
#    RouterOS repart en 1970 : le certificat devient << pas encore valide >>,
#    et tout le TLS tombe. En regenerer un maintenant le date d'aujourd'hui,
#    ce qui repare les deux cas d'un coup.
#
#    **Deux certificats, et il en faut bien deux.** Un certificat ne peut se
#    signer lui-meme que s'il porte le droit de signer des certificats
#    (key-cert-sign) - droit qu'un certificat de serveur n'a pas, et ne doit
#    pas avoir. Sans autorite, RouterOS en cherche une et repond
#    << failure: CA not found >>. On pose donc une petite autorite, qui se
#    signe elle-meme, puis elle signe le certificat du service.
#
#    Rejouable, comme le reste : l'ancien part avant que le neuf arrive. Le
#    certificat de service part en premier, l'autorite ensuite : RouterOS
#    refuse de retirer une autorite dont un certificat depend encore.
#
#    **Tout tient dans un seul bloc, et ce n'est pas un choix de style.**
#    << /certificate sign >> s'execute en arriere-plan et **toute frappe
#    pendant son travail l'interrompt** : il repond alors
#    << Process is uninterruptible, it will finish in background >>, et la
#    ligne collee derriere lui est avalee - parfois a moitie, ce qui donne un
#    << bad command name >> sur un fragment de commentaire. Les commandes
#    suivantes disparaissent sans laisser de trace. Constate sur ce parc :
#    les deux lignes qui creaient le certificat du service se sont evaporees,
#    et l'on n'a vu que le refus final du service.
#
#    Entre accolades, le terminal n'execute rien avant l'accolade fermante :
#    il accumule. Le collage ne peut donc rien interrompre. Et << :execute >>
#    rend la main tout de suite, si bien que la suite du script - dont
#    l'appel au serveur - n'attend pas les signatures.
:put "Pose du certificat de l'API, en arriere-plan..."
:execute script={
  :log info "GeMikrot : debut de la pose du certificat.";
  :do { /certificate remove [find name="gemikrot-api-cert"] } on-error={};
  :do { /certificate remove [find name="gemikrot-ca"] } on-error={};
  /certificate add name="gemikrot-ca" common-name="GeMikrot CA" days-valid=3650 key-size=2048 key-usage=key-cert-sign,crl-sign;
  /certificate sign "gemikrot-ca";
  :delay 20s;
  /certificate add name="gemikrot-api-cert" common-name="${params.tunnelAddress}" days-valid=3650 key-size=2048 key-usage=digital-signature,key-encipherment,tls-server;
  /certificate sign "gemikrot-api-cert" ca="gemikrot-ca";
  :delay 20s;
  /ip/service set www-ssl certificate="gemikrot-api-cert" disabled=no;
  :log info "GeMikrot : certificat de l'API en place, service securise actif.";
}

#    Les signatures prennent une quarantaine de secondes en tout. Vous n'avez
#    rien a attendre : la suite du script continue, et le resultat s'inscrit
#    dans le journal du routeur (Log) sous << GeMikrot >>.
#
#    **Ce journal est le seul temoin du bloc.** Il en ecrit deux lignes : une
#    au depart, une a l'arrivee. Les deux presentes, le certificat est en
#    place et le service actif. La premiere seule, le bloc s'est arrete en
#    chemin - et la ligne d'erreur de RouterOS sera juste au-dessus. Aucune
#    des deux, le bloc n'a jamais demarre.

# Ce script ne restreint PAS l'adresse de www-ssl, volontairement. Le faire
# avant d'avoir eprouve le tunnel a deja coupe un routeur en essai :
# << set www-ssl address=... >> REMPLACE la liste, et la forme censee y ajouter
# une entree l'a effacee a la place. Le resserrage est une etape separee, que
# la console propose une fois le tunnel constate - et qui, a ce moment-la,
# peut etre annulee par le tunnel lui-meme.

:put "Tunnel, compte et certificat poses. Envoi de la cle publique au serveur..."

# 5. On previent le serveur, en lui donnant la cle publique de ce routeur.
#
#    **En dernier, et rien apres.** /tool/fetch bloque le terminal le temps de
#    sa tentative. Si l'adresse ci-dessous n'est plus la bonne, il reste sur
#    << status: connecting >> et **avale les lignes collees a sa suite**, qui
#    reapparaissent tronquees en erreur de syntaxe. On cherche alors un defaut
#    de script la ou il n'y a qu'une adresse perimee.
#
#    **Si vous lisez << timeout connecting >>**, le serveur n'est pas joignable
#    depuis ce routeur. L'adresse est peut-etre juste : sur Windows, le
#    pare-feu bloque par defaut toute entree quand la carte reseau est en
#    profil << Public >>, et le port reste ferme vu du routeur. Il faut
#    l'ouvrir cote serveur. Tout le reste de ce script a deja ete pose : il
#    suffira de recoller un nouveau script une fois le port ouvert.
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
