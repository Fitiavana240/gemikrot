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
  estPrivee,
  hoteDeLUrl,
  type AdressePerimee,
} from '../common/adresses-locales.js';

/** Durée de vie du jeton. Assez pour aller au routeur, trop court pour traîner. */
const TOKEN_TTL_MS = 30 * 60 * 1000;
/** Nom du compte d'API dédié créé sur le routeur. Jamais `admin`. */
const API_USERNAME = 'gemikrot-api';
const WG_INTERFACE = 'gemikrot';
/**
 * Le port sur lequel le routeur ecoute le tunnel.
 *
 * Fixe, et le meme pour tout le parc : c'est le serveur qui appelle, il doit
 * savoir ou frapper sans avoir a le demander. 13231 est celui que RouterOS
 * propose par defaut pour WireGuard.
 */
const WG_LISTEN_PORT = 13231;

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
   * L'adresse a laquelle le routeur rappellera cette console, a la fin du
   * script.
   *
   * C'est **elle** qui impose de raccorder depuis le reseau du routeur, et
   * non plus le point d'appel du tunnel : depuis que le serveur appelle le
   * routeur, le tunnel n'a plus cette contrainte. Dire le contraire enverrait
   * chercher au mauvais endroit -- ce qui a deja coute des heures ici.
   */
  rappel: string;
  rappelPrive: boolean;
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
/**
 * L'etat d'un routeur dans le tunnel, **vu du serveur**.
 *
 * Tout ici se lit sans toucher au routeur : la fiche, et le fichier du tunnel.
 * C'est ce qui rend ce diagnostic utilisable quand le routeur ne repond pas --
 * c'est-a-dire precisement quand on en a besoin.
 */
export interface EtatRouteurDansLeTunnel {
  routerId: string;
  label: string;
  tunnelAddress: string;
  /**
   * L'adresse a laquelle le serveur appelle ce routeur, `null` si aucune.
   *
   * Sans elle, le routeur n'est pilotable que depuis son propre reseau : le
   * serveur ne sait pas ou frapper. C'est le renseignement decisif, et il
   * n'apparaissait nulle part.
   */
  pointDAppel: string | null;
  /** Le pair de ce routeur est-il inscrit dans le fichier du tunnel ? */
  pairEcrit: boolean;
  /** Ce qui manque a ce routeur pour etre joint de loin, en clair. */
  manque: string | null;
  lastSeenAt: Date | null;
}

export interface EtatServeurTunnel {
  endpoint: string;
  /** Une adresse privee ne se joint que depuis le meme reseau. */
  endpointPrive: boolean;
  /** La console applique-t-elle elle-meme les pairs sur le serveur ? */
  pilote: boolean;
  /** Le nom de l'interface cote serveur, pour les commandes a passer. */
  interfaceName: string;
  /** Le fichier que la console ecrit, ou la chaine vide si aucun n'est regle. */
  fichier: string;
  /** Ce qui empeche un routeur distant de joindre ce serveur, en clair. */
  manques: string[];
  /** Les pairs a poser a la main, faute de pilotage. */
  pairs: { label: string; commande: string }[];
  /** Un par routeur : le serveur peut-il l'appeler, et sinon pourquoi. */
  routeurs: EtatRouteurDansLeTunnel[];
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

    // Sans port quand il n'y en a pas d'explicite : « 192.168.88.23:3000 » se
    // lit, « 192.168.88.23: » fait douter de ce qui manque.
    const rappelBrut = this.config.get<string>('PUBLIC_BASE_URL') ?? '';
    const hoteDuRappel = rappelBrut.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    return {
      id: enrollment.id,
      label,
      tunnelAddress,
      expiresAt: enrollment.expiresAt,
      script: this.buildScript({ token, apiPassword, tunnelAddress }),
      endpoint: `${this.wireguard.settings.endpointHost}:${this.wireguard.settings.endpointPort}`,
      endpointPrive: this.wireguard.endpointPrive,
      rappel: hoteDuRappel,
      rappelPrive: estPrivee(hoteDeLUrl(this.config.get<string>('PUBLIC_BASE_URL') ?? '')),
      adressePerimee: this.adresseDeRappelPerimee(),
    };
  }

  /**
   * Le pair du serveur : **c'est ce routeur qui appelle, toujours.**
   *
   * Un seul sens, et j'ai perdu une journee a en essayer deux. Il n'existe
   * aucun cas ou le serveur appelant le routeur vaut mieux :
   *
   * - Adresse du serveur publique : le routeur l'appelle, de partout.
   * - Adresse du serveur privee : le routeur doit etre sur le meme reseau
   *   pour l'atteindre -- mais alors il l'atteint tres bien. L'adresse privee
   *   limite la portee, elle ne change pas le sens.
   *
   * L'inverse exige du routeur exactement ce qu'on cherche a ne pas exiger :
   * etre joignable de l'exterieur. Un routeur derriere un NAT -- meme derriere
   * deux, meme derriere celui de son operateur -- peut toujours appeler et ne
   * peut jamais etre appele. C'est ce qui a bloque ce parc : un second routeur
   * devant le hAP, et l'operateur au-dessus.
   */
  private pairDuServeur(): string {
    const { endpointHost, endpointPort, publicKey, subnet } = this.wireguard.settings;

    const avertissement = this.wireguard.endpointPrive
      ? [
          '#',
          `#    **${endpointHost} est une adresse privee.** Ce routeur ne la joindra`,
          '#    que depuis le meme reseau : le tunnel montera ici, et nulle part',
          '#    ailleurs. Pour un acces a distance, le serveur doit porter une',
          '#    adresse publique -- aucun reglage de ce cote-ci ne remplace cela.',
        ]
      : [];

    return [
      "# 2. Le serveur, comme pair. **C'est ce routeur qui appelle.**",
      '#',
      '#    Le seul sens qui marche : un routeur derriere un NAT -- meme derriere',
      '#    deux, meme derriere celui de son operateur -- peut toujours appeler,',
      '#    jamais etre appele. Aucun port a ouvrir ici, aucune adresse fixe',
      '#    necessaire de ce cote.',
      '#',
      '#    Le battement de 25 secondes maintient ouverte, dans le NAT, la porte',
      '#    que le premier paquet a percee. Sans lui elle se referme en quelques',
      '#    dizaines de secondes et le serveur ne peut plus repondre : le tunnel',
      '#    marcherait une minute puis mourrait, ce qui se diagnostique bien plus',
      "#    mal qu'une panne franche.",
      ...avertissement,
      ':do { /interface/wireguard/peers/remove [find comment="GeMikrot"] } on-error={}',
      `/interface/wireguard/peers/add interface=${WG_INTERFACE} \\\\`,
      `    public-key="${publicKey}" \\\\`,
      `    endpoint-address=${endpointHost} endpoint-port=${endpointPort} \\\\`,
      `    allowed-address=${subnet} \\\\`,
      '    persistent-keepalive=25 comment="GeMikrot"',
    ].join('\\n');
  }

  /**
   * Fait sortir la console du portail captif, quand elle est sur son reseau.
   *
   * **Le HotSpot occupe le port 80 du routeur, et souvent le 443 avec lui.**
   * Sur ce parc, une requete vers le port 80 du routeur ne rend pas WebFig
   * mais une redirection vers la page du portail — et sur 443, faute de
   * certificat pour ce service-la, il accepte la connexion puis la coupe net.
   * Vu de la console, cela ressemble trait pour trait a un routeur dont le
   * certificat d'API serait invalide : meme absence de reponse, meme coupure
   * sans un octet. On cherche alors du cote du certificat, qui n'y est pour
   * rien.
   *
   * Le contournement dit au HotSpot d'ignorer cette machine : ses paquets ne
   * passent plus par le portail, dans les deux sens. Le routeur peut alors
   * la rappeler, et elle peut joindre l'API.
   *
   * **Emis seulement pour une adresse privee.** Un serveur en production a une
   * adresse publique, n'est pas sur le reseau du HotSpot, et n'a donc rien a
   * contourner : la ligne serait au mieux inutile, au pire une adresse
   * etrangere posee en exception dans le portail d'un exploitant.
   */
  private contournementHotspot(): string {
    const rappel = this.config.get<string>('PUBLIC_BASE_URL');
    const hote = rappel ? hoteDeLUrl(rappel) : '';
    if (!hote || !estPrivee(hote)) return '';

    return [
      '# 4 bis. La console, hors du portail captif.',
      '#',
      '#    Le HotSpot occupe le port 80 du routeur, et souvent le 443 avec lui.',
      '#    Tant que la console est vue comme un client du portail, le routeur ne',
      '#    peut ni la rappeler, ni lui servir son API : la connexion est acceptee',
      '#    puis coupee sans un octet, ce qui ressemble a un certificat invalide',
      '#    sans en etre un.',
      '#',
      '#    Cette exception ne concerne que la machine qui porte la console, et',
      '#    elle ne change rien pour vos clients.',
      `:do { /ip/hotspot/ip-binding/remove [find address="${hote}"] } on-error={}`,
      `/ip/hotspot/ip-binding/add address=${hote} type=bypassed comment="GeMikrot - console"`,
      '',
    ].join('\n');
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
    if (!this.wireguard.cheminDuFichier) {
      manques.push(
        "WIREGUARD_CONFIG_PATH n'est pas renseigne : la console ne peut pas ecrire les " +
          'pairs dans le fichier du tunnel, et chacun devra etre recopie a la main.',
      );
    }

    // Seuls les routeurs qui ont une cle : les autres ne sont pas dans le
    // tunnel, et proposer une commande pour eux n'aurait pas de sens.
    const routeurs = await this.prisma.scopedStrict.router.findMany({
      where: { tunnelPublicKey: { not: null }, tunnelAddress: { not: null } },
      select: {
        id: true,
        label: true,
        tunnelPublicKey: true,
        tunnelAddress: true,
        tunnelEndpoint: true,
        lastSeenAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const inscrits = new Set(this.wireguard.pairsDuFichier().map((p) => p.publicKey));

    return {
      endpoint: `${endpointHost}:${endpointPort}`,
      endpointPrive: prive,
      pilote,
      interfaceName,
      fichier: this.wireguard.cheminDuFichier,
      manques,
      pairs: routeurs.map((r) => ({
        label: r.label,
        commande: `wg set ${interfaceName} peer ${r.tunnelPublicKey} allowed-ips ${r.tunnelAddress}/32`,
      })),
      routeurs: routeurs.map((r) => {
        const pairEcrit = inscrits.has(r.tunnelPublicKey!);
        /**
         * Une seule phrase, celle qui bloque en premier.
         *
         * En empiler trois ferait relire le meme diagnostic a chaque fois, et
         * la premiere est de toute facon la seule sur laquelle on peut agir.
         */
        const manque = !r.tunnelEndpoint
          ? "Ce routeur n'a pas de nom public : le serveur ne sait pas ou l'appeler. " +
            'Il reste pilotable depuis son propre reseau. Relancez le raccordement pour ' +
            'lui en faire demander un a MikroTik.'
          : !this.wireguard.cheminDuFichier
            ? 'Le fichier du tunnel n\'est pas indique au serveur : son pair doit etre ' +
              'recopie a la main.'
            : !pairEcrit
              ? 'Son pair ne figure pas dans le fichier du tunnel. Relancez le ' +
                'raccordement, ou ajoutez-le a la main.'
              : null;

        return {
          routerId: r.id,
          label: r.label,
          tunnelAddress: r.tunnelAddress!,
          pointDAppel: r.tunnelEndpoint,
          pairEcrit,
          manque,
          lastSeenAt: r.lastSeenAt,
        };
      }),
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
    body: {
      publicKey: string;
      identity?: string;
      serial?: string;
      endpoint?: string;
      /** << oui >>, << non >> ou << inconnu >>, calcule par le routeur lui-meme. */
      derriereNat?: string;
    },
  ): Promise<{
    routerId: string;
    tunnelAddress: string;
    peerApplied: boolean;
    /**
     * Le pair a ete ecrit dans le fichier du tunnel, sans etre charge.
     *
     * Ce n'est pas `peerApplied` : le fichier est juste, le tunnel qui tourne
     * ne le sait pas encore. C'est l'etat le plus frequent sur un serveur
     * Windows, ou la console n'a pas les droits de piloter `wg` -- et celui
     * qu'il faut nommer, parce que << injoignable >> decrit un routeur eteint.
     */
    peerEcrit: boolean;
    /** Vrai quand une fiche existante a ete reprise au lieu d'en creer une. */
    ficheReprise: boolean;
  }> {
    // Hors cloisonnement : le rappel du routeur arrive sans session. C'est
    // le jeton qui désigne l'exploitant, et tout ce qui suit s'exécute
    // dedans.
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

      const serie = body.serial?.trim() || null;
      /**
       * Le point d'appel du routeur : `nom:port`, tel que MikroTik le donne.
       *
       * Ecarte quand le nom manque -- `/ip/cloud` pas encore repondu, ou
       * fournisseur qui place le routeur derriere son propre NAT. On garderait
       * sinon un `:13231` seul, qui ressemble a une adresse et n'en est pas :
       * le serveur appellerait dans le vide, et le tunnel resterait muet sans
       * un mot d'explication.
       */
      const pointDAppel = body.endpoint?.trim().replace(/^:/, '') || null;

      /**
       * Un routeur derriere le NAT de son fournisseur **ne peut pas etre
       * appele**, et son nom public ne vaut rien.
       *
       * Le garder ferait afficher une adresse d'appel plausible, un pair
       * complet, et un tunnel qui ne monte jamais -- sans qu'aucun ecran ne
       * dise pourquoi. Mieux vaut pas d'adresse du tout : la console dit
       * alors franchement que ce routeur n'est pilotable que depuis son
       * propre reseau.
       */
      const derriereNat = body.derriereNat?.trim() === 'oui';

      /**
       * La fiche de cet appareil, s'il en a deja une.
       *
       * **Le numero de serie est la seule chose stable** qu'un routeur dise
       * de lui-meme. Son nom se change ; sa cle publique WireGuard est refaite
       * a chaque execution du script, puisque celui-ci detruit et recree
       * l'interface. Rejouer un raccordement creait donc une fiche de plus a
       * chaque fois -- et rejouer est exactement ce qu'on fait quand on croit
       * que ca n'a pas marche. Trois fiches sur le meme appareil le
       * 24/09/2026, toutes injoignables, et rien ne disait laquelle etait
       * vivante : les deux premieres portaient des cles mortes.
       *
       * Sans numero -- une machine sans carte RouterBOARD -- on cree, comme
       * avant. Deviner sur le nom serait pire : deux routeurs sortis d'usine
       * s'appellent tous les deux << MikroTik >>, et les confondre melangerait
       * les clients de deux sites.
       */
      const existante = serie
        ? await this.prisma.scopedStrict.router.findFirst({ where: { serialNumber: serie } })
        : null;

      const donnees = {
        label: body.identity?.trim() || enrollment.label,
        // L'adresse du tunnel devient l'hôte : c'est par là que le serveur
        // joindra ce routeur. L'accès direct reste ouvert tant que
        // l'exploitant ne l'a pas resserré, une fois le tunnel constaté.
        host: enrollment.tunnelAddress,
        restPort: 443,
        credentialsEncrypted: enrollment.credentialsEncrypted,
        tunnelAddress: enrollment.tunnelAddress,
        tunnelPublicKey: body.publicKey,
        serialNumber: serie,
        tunnelEndpoint:
          !derriereNat && pointDAppel && pointDAppel.includes(':') ? pointDAppel : null,
        enrolledAt: new Date(),
        status: 'enrolled',
      };

      const router = existante
        ? // La fiche garde son identifiant, et donc ses clients, ses tickets
          // et son journal. Seul ce qui decrit le tunnel est remplace : le
          // script vient de reecrire l'adresse et la cle sur le routeur, et
          // le mot de passe d'API de l'invitation remplace l'ancien, devenu
          // faux.
          await this.prisma.scopedStrict.router.update({
            where: { id: existante.id },
            data: donnees,
          })
        : await this.prisma.scopedStrict.router.create({
            data: { tenantId: enrollment.tenantId, ...donnees },
          });

      // L'invitation precedente de cette fiche n'a plus d'objet, et elle
      // porte encore un mot de passe d'API devenu faux. Elle part -- sans
      // quoi le lien ci-dessous buterait aussi sur l'unicite de `routerId`.
      await this.prisma.scopedStrict.routerEnrollment.deleteMany({
        where: { routerId: router.id, id: { not: enrollment.id } },
      });

      await this.prisma.scopedStrict.routerEnrollment.update({
        where: { id: enrollment.id },
        data: { routerId: router.id },
      });

      // Sans adresse d'appel : c'est le routeur qui appelle, et le serveur
      // apprend la sienne du premier paquet recu. Lui en donner une le ferait
      // frapper chez un routeur que son NAT rend injoignable.
      const peer = await this.wireguard.addPeer(
        { publicKey: body.publicKey, tunnelAddress: enrollment.tunnelAddress },
        router.label,
      );

      this.logger.log(
        `Routeur « ${router.label} » ${existante ? 'raccorde de nouveau' : 'enrôlé'} ` +
          `sur ${enrollment.tunnelAddress}` +
          (serie ? ` (serie ${serie})` : ' — sans numero de serie, fiche non rapprochable') +
          (peer.applied
            ? ''
            : peer.ecritDansLeFichier
              ? ' — pair ecrit dans le fichier du tunnel, a recharger'
              : ' — pair WireGuard à ajouter à la main sur le serveur'),
      );

      // Le certificat n'est pas épinglé ici : le routeur vient seulement
      // d'ouvrir le tunnel, et l'empreinte se relève depuis le serveur avec
      // le point d'entrée existant. Un routeur non épinglé est signalé dans
      // la console.
      return {
        routerId: router.id,
        tunnelAddress: enrollment.tunnelAddress,
        peerApplied: peer.applied,
        peerEcrit: peer.ecritDansLeFichier,
        ficheReprise: existante !== null,
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
    // Hors cloisonnement : le plan d'adressage du tunnel est commun à tous.
    // Une adresse tenue par l'invitation périmée d'un autre exploitant
    // bloquerait celle-ci sans que personne ne comprenne pourquoi.
    await this.prisma.routerEnrollment.deleteMany({
      where: { consumedAt: null, expiresAt: { lte: new Date() } },
    });

    const [routers, invitations] = await Promise.all([
      // Hors cloisonnement : même raison — une adresse déjà prise l'est pour
      // tout le monde, quel que soit son propriétaire.
      this.prisma.router.findMany({
        where: { tunnelAddress: { not: null } },
        select: { tunnelAddress: true },
      }),
      // Hors cloisonnement : même raison.
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
# **Une seule exception : l'interface WireGuard.** Elle porte la cle privee de
# ce routeur, et la refaire en fabriquerait une neuve - donc un pair devenu
# faux sur le serveur, a remettre a la main. Elle est creee si elle manque, et
# laissee telle quelle sinon.
#
# Les retraits sont ecrits << :do { ... } on-error={} >>, et cette forme fait
# deux choses a la fois : elle avale l'echec quand il n'y a rien a retirer -
# sur un routeur vierge, c'est le cas de tous - et elle met la commande entre
# accolades, ou le terminal n'execute rien avant l'accolade fermante. Un
# collage ne peut donc pas l'interrompre a mi-chemin.
#
# Ce script pose le tunnel, un compte applicatif aux droits limites, un
# certificat pour l'API, fait sortir la console du portail captif quand elle
# est sur votre reseau, puis previent le serveur. Il ne touche ni a votre
# compte admin, ni a vos clients, ni a la configuration de votre HotSpot -
# seulement une exception nominative pour la machine qui porte la console.
# ============================================================

# 1. Le tunnel. La cle privee est creee ici et ne quitte jamais ce routeur.
#
#    **L'interface n'est PAS refaite si elle existe deja**, et c'est la seule
#    etape de ce script qui ne recommence pas de zero. La cle privee vit dans
#    l'interface : la detruire en fabrique une neuve, donc une nouvelle cle
#    publique, donc un pair devenu faux cote serveur - qu'il faut alors
#    remettre a la main. Rejouer ce script coupait ainsi le tunnel a tous les
#    coups, et rejouer est exactement ce qu'on fait quand on croit que ca n'a
#    pas marche. Constate le 24/09/2026 : quatre executions, quatre cles,
#    quatre fois le meme depannage.
#
#    Tout le reste - adresse, route, pair, compte, certificat - se refait
#    sans dommage : rien de tout cela ne porte d'identite.
:if ([:len [/interface/wireguard/find name=${WG_INTERFACE}]] = 0) do={
  /interface/wireguard/add name=${WG_INTERFACE} listen-port=${WG_LISTEN_PORT} comment="GeMikrot"
  :put "Interface WireGuard creee."
} else={
  :put "Interface WireGuard deja presente : sa cle est conservee."
}
:do { /ip/address/remove [find interface=${WG_INTERFACE}] } on-error={}
/ip/address/add address=${params.tunnelAddress}/32 interface=${WG_INTERFACE} comment="GeMikrot"
# Une adresse en /32 ne cree aucune route : sans celle-ci, ce routeur saurait
# recevoir les appels du serveur mais pas lui repondre.
:do { /ip/route/remove [find comment="GeMikrot"] } on-error={}
/ip/route/add dst-address=${subnet} gateway=${WG_INTERFACE} comment="GeMikrot"

${this.pairDuServeur()}

# 2 bis. Le port du tunnel, ouvert en entree.
#
#    Puisque c'est le serveur qui appelle, ce routeur doit accepter d'etre
#    appele. Le pare-feu par defaut de RouterOS refuse toute connexion
#    entrante non sollicitee -- le tunnel resterait muet, **sans un mot**, et
#    l'on chercherait du cote des cles.
#
#    La regle passe en tete de la chaine : posee en queue, elle serait
#    precedee du refus general et ne servirait a rien.
#
#    Ce que cela expose : un port UDP qui ne repond rien a qui ne possede pas
#    la cle. WireGuard ne se signale pas, ne repond pas aux sondes, n'apparait
#    pas a un balayage de ports. C'est la maniere prevue de le publier.
:do { /ip/firewall/filter/remove [find comment="GeMikrot - tunnel"] } on-error={}
/ip/firewall/filter/add chain=input protocol=udp dst-port=${WG_LISTEN_PORT} \\
    action=accept comment="GeMikrot - tunnel" place-before=0

# 2 ter. Un nom stable pour ce routeur.
#
#    Son adresse publique est attribuee par le fournisseur et change sans
#    prevenir -- celle de ce parc a change en une nuit, et le tunnel a
#    silencieusement cesse de fonctionner. MikroTik donne gratuitement un nom
#    qui suit l'adresse : c'est lui que le serveur appellera.
/ip/cloud set ddns-enabled=yes
:put "Nom public demande a MikroTik, cela prend quelques secondes..."
:delay 8s

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

${this.contournementHotspot()}:put "Tunnel, compte et certificat poses. Envoi de la cle publique au serveur..."

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
#    **Le numero de serie part avec.** C'est la seule chose stable que ce
#    routeur puisse dire de lui-meme : son nom se change, et sa cle publique
#    est refaite a chaque execution de ce script. Sans lui, rejouer le
#    raccordement creait une fiche de plus a chaque fois - trois sur le meme
#    appareil le 24/09/2026, sans qu'aucune ne dise laquelle etait vivante.
#    Entre parentheses : une carte absente (CHR, x86) ferait echouer la
#    commande au lieu de rendre une chaine vide.
#
#    << :global >> et non << :local >>, et c'est la seule forme qui marche
#    ici : collees une par une dans le terminal, deux lignes ne partagent pas
#    leurs variables locales, et le numero arriverait vide **sans que rien ne
#    le signale**. Le reste du script evite les variables pour cette raison
#    precise ; celle-ci ne peut pas s'en passer, parce qu'une carte absente
#    (CHR, x86) ferait echouer la commande au lieu de rendre une chaine vide.
#    La variable est effacee juste apres, pour ne rien laisser derriere.
:global gmSerie ""
:do { :global gmSerie [/system/routerboard/get serial-number] } on-error={}
#
#    Le nom public, demande plus haut a MikroTik. C'est **l'adresse a laquelle
#    le serveur appellera ce routeur** : sans elle, le raccordement aboutit,
#    la fiche apparait, et le tunnel ne monte jamais -- le serveur ne saurait
#    pas ou frapper.
#
#    Vide si << /ip/cloud >> n'a pas encore repondu, ou si le fournisseur place ce
#    routeur derriere son propre NAT. La console le dira, plutot que de
#    laisser chercher.
:global gmNom ""
:do { :global gmNom [/ip/cloud/get dns-name] } on-error={}
#
#    **Ce routeur est-il derriere le NAT de son fournisseur ?**
#
#    C'est la question decisive, et elle ne se voit d'aucun autre endroit.
#    '/ip/cloud' rend un nom des qu'il est active, et ce nom resout : tout
#    parait en place. Mais l'adresse qu'il annonce est celle **vue de
#    l'exterieur**, et si le fournisseur partage une adresse publique entre
#    ses abonnes -- ou si un second routeur se tient devant celui-ci -- elle
#    n'appartient a aucun equipement d'ici. Personne ne peut alors appeler ce
#    routeur, quel que soit le port ouvert.
#
#    La comparaison se fait ici parce que ce routeur seul connait ses propres
#    adresses : le serveur, lui, ne verrait qu'un nom qui resout normalement.
#    Constate sur ce parc : 129.222.109.230 annonce, 192.168.1.x sur le WAN,
#    et 100.64.0.1 au saut suivant -- la plage que les operateurs emploient
#    justement pour partager une adresse.
:global gmNat "inconnu"
:do { :if ([:len [/ip/address/find address~("^" . [/ip/cloud/get public-address])]] > 0) do={ :set gmNat "non" } else={ :set gmNat "oui" } } on-error={}
/tool/fetch url="${callbackUrl}" http-method=post http-header-field="Content-Type:application/json" http-data=("{\\"publicKey\\":\\"" . [/interface/wireguard/get [find name=${WG_INTERFACE}] public-key] . "\\",\\"identity\\":\\"" . [/system/identity/get name] . "\\",\\"serial\\":\\"" . $gmSerie . "\\",\\"endpoint\\":\\"" . $gmNom . ":${WG_LISTEN_PORT}\\",\\"derriereNat\\":\\"" . $gmNat . "\\"}") output=none
:set gmSerie
:set gmNom
:set gmNat
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
