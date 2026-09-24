import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { ConsoleLogger, RouterOSRestClient } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RouterCredentialsService } from './router-credentials.service.js';
import { WireguardService } from './wireguard.service.js';
import { RoutersService } from './routers.service.js';
import { RouterEnrollmentService } from './router-enrollment.service.js';
import { adressePerimee, hoteDeLUrl, type AdressePerimee } from '../common/adresses-locales.js';

/**
 * Raccorder un routeur sans jamais coller de script.
 *
 * Le parcours d'origine demandait de copier une trentaine de lignes dans le
 * terminal Winbox. Il a le mérite d'être transparent — l'exploitant voit
 * exactement ce qui sera fait sur son matériel — mais il échoue de bien des
 * façons : une ligne perdue au collage, un `/tool/fetch` qui bloque et avale
 * la suite, un terminal qui rend les accents en mojibake. Tout cela est
 * arrivé, sur ce parc, en une seule séance.
 *
 * Ici la console fait le travail elle-même, et c'est possible pour une raison
 * précise : **au premier raccordement, l'exploitant est sur le même réseau que
 * son routeur**. Il n'a pas encore besoin du tunnel pour l'atteindre — c'est
 * justement le tunnel qu'on vient poser.
 *
 * **Le mot de passe administrateur ne survit pas à l'appel.** Il n'est ni
 * enregistré, ni journalisé, ni renvoyé : il vit dans une variable locale, le
 * temps de trois écritures REST, et disparaît avec elle. Ce qui reste en base,
 * c'est le compte `gemikrot-api` aux droits limités, dont le mot de passe est
 * fabriqué ici et chiffré. Conserver les identifiants maîtres ferait d'une
 * seule intrusion sur la plateforme la prise de contrôle de **tous** les
 * routeurs de **tous** les exploitants — le calcul n'est pas discutable.
 *
 * **Rien n'est fait avant d'avoir sondé.** Poser un tunnel sur un routeur
 * qu'on n'a pas identifié, ou dont la version ne sait pas faire de WireGuard,
 * laisserait une configuration à moitié écrite que personne ne saurait
 * retrouver.
 */

/** Nom du compte d'API dédié créé sur le routeur. Jamais `admin`. */
const COMPTE_API = 'gemikrot-api';
/** Nom de l'interface WireGuard, côté routeur. */
const INTERFACE_WG = 'gemikrot';
/**
 * Le port sur lequel le routeur ecoute le tunnel.
 *
 * Fixe, et le meme pour tout le parc : c'est le serveur qui appelle, il doit
 * savoir ou frapper sans avoir a le demander.
 */
const PORT_ECOUTE_WG = 13231;
/** Marque posée sur tout ce que la console crée, pour pouvoir le retrouver. */
const MARQUE = 'GeMikrot';
/** WireGuard et l'API REST sont apparus en 7.x : rien avant ne convient. */
const VERSION_MINIMALE = 7;

export interface SondageRouteur {
  joignable: boolean;
  /** Version de RouterOS, telle qu'elle se lit : `7.24.4`. */
  version: string | null;
  versionSuffisante: boolean;
  /** `/system/identity` — le nom que le routeur se donne. */
  identite: string | null;
  modele: string | null;
  /** Empreinte SHA-256 du certificat, pour l'épinglage. */
  empreinte: string | null;
  /** Ce qui s'est passé, en clair, qu'il ait réussi ou non. */
  message: string;
  /** L'adresse que le routeur devra rappeler, quand elle a déjà glissé. */
  adressePerimee: AdressePerimee | null;
}

export interface RaccordementAssiste {
  routerId: string;
  label: string;
  identite: string;
  version: string;
  tunnelAddress: string;
  /** Les gestes posés sur le routeur, dans l'ordre, pour les afficher. */
  etapes: string[];
}

/**
 * Pourquoi le certificat n'a pas pu etre releve, et quoi faire.
 *
 * Deux pannes se cachent derriere le meme ecran, et leurs remedes n'ont rien
 * a voir :
 *
 * - **Rien ne repond** : le routeur est eteint, ailleurs, ou son service est
 *   arrete. Il n'y a rien a reparer depuis ici.
 * - **Le port repond puis coupe** : le service tourne, mais il n'a pas de
 *   certificat utilisable. C'est reparable, et **par le script** — qui pose
 *   un certificat neuf et le rattache a l'API.
 *
 * La seconde ne s'envoie surtout pas vers un terminal Winbox : la regle de ce
 * produit est qu'on n'y tape rien, on n'y colle que ce que la console a
 * genere. Une panne qu'on ne sait reparer qu'a la main est une panne qu'on ne
 * repare pas.
 */
export function messageDeSondageRate(hote: string, port: number, e: unknown): string {
  const detail = e instanceof Error ? e.message : String(e);
  // Le routeur a accepte la connexion puis l'a coupee : signature exacte d'un
  // service TLS sans certificat valide. Releve sur ce parc, sur `www-ssl` et
  // `api-ssl` a la fois — les deux partagent le certificat du routeur.
  const tlsCoupe =
    /ECONNRESET|socket disconnected|handshake|alert|SSL|TLS/i.test(detail) &&
    !/ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|ENETUNREACH/i.test(detail);

  if (tlsCoupe) {
    return (
      `Le routeur ${hote} répond sur le port ${port}, mais coupe la connexion sécurisée : ` +
      `il n'a pas de certificat utilisable. C'est fréquent après une coupure de courant — ` +
      `l'horloge repart en arrière et le certificat devient « pas encore valide ». ` +
      `Utilisez « Préparer un script à coller » : le script pose un certificat neuf et rétablit ` +
      `l'API, puis ce raccordement automatique fonctionnera. Détail : ${detail}`
    );
  }
  return (
    `Aucune réponse de ${hote}:${port}. Vérifiez que le routeur est allumé et que vous êtes sur ` +
    `le même réseau que lui. Si l'adresse est bonne, préparez un script à coller : il rétablit ` +
    `le service sécurisé du routeur. Détail : ${detail}`
  );
}

@Injectable()
export class RaccordementAssisteService {
  private readonly logger = new Logger(RaccordementAssisteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: RouterCredentialsService,
    private readonly wireguard: WireguardService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly routers: RoutersService,
    // Pour son allocateur d'adresses, et lui seul : deux allocateurs pour une
    // seule plage finiraient par donner la meme adresse a deux routeurs.
    private readonly enrolement: RouterEnrollmentService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Regarde le routeur sans rien y écrire.
   *
   * Deux choses se vérifient ici et nulle part ailleurs : que les identifiants
   * ouvrent bien une session, et que la version sait faire du WireGuard.
   * Découvrir la seconde après avoir créé un compte laisserait une trace sur
   * le matériel de quelqu'un pour une opération qui ne pouvait pas aboutir.
   */
  async sonder(dto: {
    host: string;
    port?: number;
    username: string;
    password: string;
  }): Promise<SondageRouteur> {
    const port = dto.port ?? 443;
    const perimee = this.adresseDeRappelPerimee();

    let empreinte: string | null = null;
    try {
      empreinte = (await this.routers.probeFingerprint(dto.host, port)).fingerprint256;
    } catch (e) {
      return {
        joignable: false,
        version: null,
        versionSuffisante: false,
        identite: null,
        modele: null,
        empreinte: null,
        adressePerimee: perimee,
        message: messageDeSondageRate(dto.host, port, e),
      };
    }

    try {
      const client = this.client(dto.host, port, dto.username, dto.password, empreinte);
      const [resource, identity] = await Promise.all([
        client.get<{ version?: string; 'board-name'?: string }>('/system/resource'),
        client.get<{ name?: string }>('/system/identity'),
      ]);

      const version = resource.version ?? null;
      const majeure = version ? Number.parseInt(version, 10) : 0;
      const versionSuffisante = majeure >= VERSION_MINIMALE;

      return {
        joignable: true,
        version,
        versionSuffisante,
        identite: identity.name ?? null,
        modele: resource['board-name'] ?? null,
        empreinte,
        adressePerimee: perimee,
        message: versionSuffisante
          ? `Routeur reconnu : ${identity.name ?? 'sans nom'}, RouterOS ${version}.`
          : `Ce routeur est en RouterOS ${version}. Le raccordement demande la version ` +
            `${VERSION_MINIMALE} ou plus récente : WireGuard et l'API REST n'existent pas avant. ` +
            `Mettez-le à jour (System > Packages > Check For Updates), puis recommencez.`,
      };
    } catch (e) {
      return {
        joignable: false,
        version: null,
        versionSuffisante: false,
        identite: null,
        modele: null,
        empreinte,
        adressePerimee: perimee,
        // Le certificat a répondu mais la session non : c'est presque toujours
        // le mot de passe, ou un compte sans la permission `rest-api`.
        message:
          `Le routeur répond, mais refuse ces identifiants. Vérifiez le nom et le mot de passe ` +
          `de Winbox, et que ce compte a bien les permissions « api » et « rest-api ». ` +
          `Détail : ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  /**
   * Pose le tunnel, crée le compte dédié, puis enregistre le routeur.
   *
   * Chaque geste efface d'abord ce qu'un essai précédent aurait laissé. Sans
   * cela, un second passage échouerait sur « already have » — et l'exploitant
   * qui recommence après une coupure est exactement celui qu'il ne faut pas
   * bloquer.
   */
  async raccorder(dto: {
    host: string;
    port?: number;
    username: string;
    password: string;
    label?: string;
  }): Promise<RaccordementAssiste> {
    const tenantId = this.tenantContext.requireTenantId();
    const port = dto.port ?? 443;

    const sondage = await this.sonder(dto);
    if (!sondage.joignable || !sondage.empreinte) {
      throw new BadRequestException(sondage.message);
    }
    if (!sondage.versionSuffisante) {
      throw new BadRequestException(sondage.message);
    }

    const client = this.client(dto.host, port, dto.username, dto.password, sondage.empreinte);
    const { endpointHost, endpointPort, publicKey, subnet } = this.wireguard.settings;
    /**
     * L'adresse de tunnel d'un routeur deja connu est **reprise**, jamais
     * reallouee.
     *
     * Relance sur un routeur qui marchait, l'assistant allouait une adresse
     * neuve, la posait sur le routeur, et reecrivait le pair du serveur avec
     * elle. Le pair qui fonctionnait etait donc remplace par un pair qui ne
     * mene nulle part -- et comme la cle publique, elle, ne change plus, le
     * nouveau bloc ecrasait l'ancien dans le fichier du tunnel. Constate le
     * 24/09/2026 : un raccordement reussi casse par le clic suivant.
     *
     * Cherche par hote et port, comme la reprise de fiche plus bas : deux
     * lignes qui pointent la meme machine sont la meme machine.
     */
    const dejaConnu = await this.prisma.scopedStrict.router.findFirst({
      where: { host: dto.host, restPort: port, tunnelAddress: { not: null } },
      select: { tunnelAddress: true },
      orderBy: { createdAt: 'asc' },
    });
    const tunnelAddress =
      dejaConnu?.tunnelAddress ?? (await this.enrolement.allocateAddress());
    // Fabriqué ici : RouterOS n'offre pas d'aléa digne de ce nom en script, et
    // le serveur doit de toute façon connaître ce mot de passe pour s'en servir.
    const motDePasseApi = randomBytes(24).toString('base64url');
    const etapes: string[] = [];

    const { portOuvert } = await this.poserLeTunnel(client, {
      tunnelAddress,
      endpointHost,
      endpointPort,
      publicKey,
      subnet,
    });
    etapes.push(
      `Interface WireGuard « ${INTERFACE_WG} » en place, adresse ${tunnelAddress} dans le tunnel.`,
    );
    etapes.push(
      portOuvert
        ? `Port ${PORT_ECOUTE_WG} ouvert en entrée : ce routeur accepte d'être appelé.`
        : `⚠ Port ${PORT_ECOUTE_WG} NON ouvert : le pare-feu a refusé la règle. ` +
          `Ce routeur ne sera pilotable que depuis son propre réseau.`,
    );

    await this.poserLeCompte(client, motDePasseApi);
    etapes.push(
      `Compte « ${COMPTE_API} » créé, aux droits limités. Votre compte administrateur est intact.`,
    );

    // La cle publique est **lue sur le routeur**, jamais fournie : la privee
    // a ete produite la-bas et ne doit pas en sortir. C'est toute la raison
    // pour laquelle le serveur ne configure pas le tunnel de bout en bout.
    const cleDuRouteur = await this.clePubliqueDuTunnel(client);

    // Le nom public d'abord : c'est lui que le pair portera comme adresse
    // d'appel. Le poser apres coup obligerait a reecrire le fichier du tunnel
    // une seconde fois, et laisserait entre-temps un pair qu'on ne sait pas
    // joindre.
    const appel = await this.pointDAppel(client);
    etapes.push(
      appel
        ? `Nom public obtenu aupres de MikroTik : ${appel}. Ce routeur sera joignable de loin.`
        : `Aucun nom public : ce routeur ne sera pilotable que depuis son propre reseau. ` +
          `Son fournisseur le place peut-etre derriere son NAT.`,
    );

    const pair = await this.wireguard.addPeer(
      // Sans adresse d'appel : c'est le routeur qui appelle.
      { publicKey: cleDuRouteur, tunnelAddress },
      // La fiche n'existe pas encore a ce stade : l'etiquette vient de ce que
      // l'exploitant a saisi, ou de l'identite lue sur le routeur.
      dto.label?.trim() || sondage.identite || dto.host,
    );
    etapes.push(
      pair.applied
        ? `Routeur ajouté comme pair sur le serveur : le tunnel peut s'établir.`
        : pair.ecritDansLeFichier
          ? `Pair écrit dans le fichier du tunnel. Rechargez le tunnel pour qu'il le prenne.`
          : `Pair à ajouter à la main sur le serveur — le tunnel ne s'établira pas avant.`,
    );

    // Le numero de serie : la seule chose stable qu'un routeur dise de
    // lui-meme. Son nom se change, sa cle publique est refaite des qu'on
    // recree l'interface. Sans lui, deux passages de l'assistant sur le meme
    // appareil ne peuvent pas etre rapproches autrement que par l'hote, qui
    // change des qu'on bascule sur le tunnel.
    const serie = await this.numeroDeSerie(client);
    const label = dto.label?.trim() || sondage.identite || dto.host;

    /**
     * Ce routeur est-il deja connu ?
     *
     * Relancer l'assistant sur un routeur deja raccorde doit le **reparer**,
     * pas en creer un second. C'est arrive des le premier usage : deux lignes
     * pour le meme hAP, deux entrees dans le selecteur, et un import qui
     * compterait tout en double.
     *
     * L'hote et le port font l'identite : deux lignes qui pointent la meme
     * machine sont la meme machine. Le nom, lui, se change librement et ne
     * prouve rien.
     */
    const connu = await this.prisma.scopedStrict.router.findFirst({
      where: { host: dto.host, restPort: port },
      orderBy: { createdAt: 'asc' },
    });

    const routeur = connu
      ? await this.routers.update(
          connu.id,
          {
            // Le mot de passe du compte dedie vient d'etre remplace sur le
            // routeur : garder l'ancien en base rendrait la console muette.
            username: COMPTE_API,
            password: motDePasseApi,
            tlsFingerprint: sondage.empreinte,
            // Le nom n'est pas touche : l'exploitant l'a peut-etre choisi, et
            // l'ecraser par l'identite du routeur lui ferait perdre son
            // repere sur un parc a plusieurs sites.
          },
          undefined,
        )
      : await this.routers.create(
      {
        label,
        // **L'adresse locale, pas celle du tunnel.** Un tunnel qui vient
        // d'etre pose n'a pas encore echange de poignee de main ; basculer
        // la console dessus rendrait le routeur injoignable dans la seconde
        // qui suit un raccordement reussi. L'adresse qu'on vient d'eprouver
        // reste en service, et le tunnel prend le relais quand il aura
        // prouve qu'il fonctionne.
        host: dto.host,
        restPort: port,
        username: COMPTE_API,
        password: motDePasseApi,
        tlsFingerprint: sondage.empreinte,
      },
      undefined,
    );
    etapes.push(
      connu
        ? `Routeur déjà connu de la console : sa fiche a été reprise, pas dupliquée.`
        : `Routeur enregistré dans la console, certificat épinglé.`,
    );

    // Hors cloisonnement : cette fiche vient d'être créée, ou retrouvée par
    // le client cloisonné, quelques lignes plus haut. On la complète.
    await this.prisma.router.update({
      where: { id: routeur.id },
      data: {
        tunnelAddress,
        tunnelPublicKey: cleDuRouteur,
        // Le point d'appel et le numero de serie : sans le premier, le serveur
        // ne sait pas ou joindre ce routeur de loin, et la fiche paraitrait
        // complete tout en restant inutilisable ailleurs que sur place.
        tunnelEndpoint: appel,
        serialNumber: serie,
        // `enrolledAt` reste vide a dessein : c'est lui qui fait basculer la
        // console sur le tunnel, et un tunnel pose n'est pas un tunnel
        // eprouve. L'onglet Tunnel le constate, et bascule alors.
        status: 'online',
        lastSeenAt: new Date(),
      },
    });

    await this.audit.log({
      tenantId,
      action: 'ASSISTED_ENROLLMENT',
      targetType: 'Router',
      targetId: routeur.id,
      // Le nom du compte administrateur employé est tracé, jamais son mot de
      // passe : savoir qui a raccordé est utile, le rejouer ne l'est pas.
      payloadDiff: {
        host: dto.host,
        version: sondage.version,
        identite: sondage.identite,
        compteEmploye: dto.username,
        tunnelAddress,
      },
    });

    return {
      routerId: routeur.id,
      label,
      identite: sondage.identite ?? label,
      version: sondage.version ?? '',
      tunnelAddress,
      etapes,
    };
  }

  /**
   * Interface, adresse, route et pair — dans cet ordre, et sans les accents
   * d'un script collé à la main.
   *
   * L'adresse en /32 ne crée aucune route : sans la route explicite vers le
   * sous-réseau, ce routeur saurait recevoir les appels du serveur mais pas
   * lui répondre. Le défaut est particulièrement pénible parce qu'il ressemble
   * à un tunnel qui marche à moitié.
   */
  private async poserLeTunnel(
    client: RouterOSRestClient,
    p: {
      tunnelAddress: string;
      endpointHost: string;
      endpointPort: number | string;
      publicKey: string;
      subnet: string;
    },
  ): Promise<{ portOuvert: boolean }> {
    /**
     * **L'interface n'est pas refaite si elle existe deja.**
     *
     * La cle privee vit dedans : la detruire en fabrique une neuve, donc une
     * nouvelle cle publique, donc un pair devenu faux cote serveur -- a
     * remettre a la main. Relancer l'assistant coupait ainsi le tunnel a tous
     * les coups, et le relancer est exactement ce qu'on fait quand on croit
     * que ca n'a pas marche.
     *
     * Tout le reste -- adresse, route, pair, compte -- se refait sans dommage :
     * rien de cela ne porte d'identite.
     */
    const interfaces = await client.get<{ name?: string }[]>('/interface/wireguard');
    if (!interfaces.some((i) => i.name === INTERFACE_WG)) {
      await client.put('/interface/wireguard', {
        name: INTERFACE_WG,
        'listen-port': String(PORT_ECOUTE_WG),
        comment: MARQUE,
      });
    }

    await this.nettoyer(client, '/ip/address', (x) => x.interface === INTERFACE_WG);
    await client.put('/ip/address', {
      address: `${p.tunnelAddress}/32`,
      interface: INTERFACE_WG,
      comment: MARQUE,
    });

    await this.nettoyer(client, '/ip/route', (x) => x.comment === MARQUE);
    await client.put('/ip/route', {
      'dst-address': p.subnet,
      gateway: INTERFACE_WG,
      comment: MARQUE,
    });

    /**
     * Le serveur, comme pair, **sans point d'appel**.
     *
     * C'est le serveur qui appellera ce routeur. Le sens inverse reste le bon
     * quand le serveur a une adresse publique fixe ; il s'effondre des que le
     * serveur est mobile, car un portable en partage de connexion recoit une
     * adresse privee d'operateur que personne ne peut appeler.
     *
     * Sans point d'appel, WireGuard apprend l'adresse du serveur du premier
     * paquet recu et la suit quand elle change. Et pas de battement : on ne
     * maintient pas ouverte une conversation avec quelqu'un dont on ignore
     * l'adresse. C'est au serveur de le faire.
     */
    await this.nettoyer(client, '/interface/wireguard/peers', (x) => x.comment === MARQUE);
    await client.put('/interface/wireguard/peers', {
      interface: INTERFACE_WG,
      'public-key': p.publicKey,
      'allowed-address': p.subnet,
      comment: MARQUE,
    });

    /**
     * Le port du tunnel, ouvert en entree, en tete de chaine.
     *
     * Le pare-feu par defaut de RouterOS refuse toute connexion entrante non
     * sollicitee : le tunnel resterait muet, **sans un mot**, et l'on
     * chercherait du cote des cles. Posee en queue, la regle serait precedee
     * du refus general et ne servirait a rien.
     *
     * Ce que cela expose : un port UDP qui ne repond rien a qui ne possede pas
     * la cle. WireGuard ne se signale pas et n'apparait pas a un balayage.
     */
    await this.nettoyer(
      client,
      '/ip/firewall/filter',
      (x) => x.comment === `${MARQUE} - tunnel`,
    );
    /**
     * L'echec n'emporte pas le raccordement.
     *
     * `place-before` n'est pas accepte partout en REST selon la version, et
     * certains parcs ont un pare-feu gere autrement. Un refus faisait remonter
     * un << Internal server error >> apres que tout le reste avait deja ete
     * pose -- et l'ecran ne disait pas laquelle des dix etapes avait echoue.
     *
     * Le tunnel ne montera pas sans cette regle, mais le routeur reste
     * enregistre et pilotable depuis son reseau. La console le dit plutot que
     * de tout perdre.
     */
    try {
      await client.put('/ip/firewall/filter', {
        chain: 'input',
        protocol: 'udp',
        'dst-port': String(PORT_ECOUTE_WG),
        action: 'accept',
        comment: `${MARQUE} - tunnel`,
        'place-before': '0',
      });
      return { portOuvert: true };
    } catch (erreur) {
      this.logger.warn(
        `Port du tunnel non ouvert sur ${INTERFACE_WG} : ${String(erreur)}. ` +
          'Le routeur ne pourra pas etre appele de loin.',
      );
      return { portOuvert: false };
    }
  }

  /**
   * Le nom public que MikroTik donne a ce routeur, et son port d'ecoute.
   *
   * L'adresse publique d'un routeur est attribuee par son fournisseur et
   * change sans prevenir -- celle de ce parc a change en une nuit, et le
   * tunnel a silencieusement cesse de fonctionner. `/ip/cloud` donne
   * gratuitement un nom qui suit l'adresse.
   *
   * Rend `null` plutot que d'echouer : un raccordement qui a marche ne doit
   * pas etre perdu parce que le service de noms tarde. La console le dira, et
   * le routeur restera pilotable depuis son propre reseau.
   */
  private async pointDAppel(client: RouterOSRestClient): Promise<string | null> {
    try {
      await client.patch('/ip/cloud', { 'ddns-enabled': 'yes' });
      // Le nom n'est pas attribue dans la seconde : MikroTik doit joindre son
      // service et enregistrer l'adresse.
      for (let essai = 0; essai < 6; essai += 1) {
        const cloud = await client.get<{ 'dns-name'?: string }>('/ip/cloud');
        const nom = cloud?.['dns-name']?.trim();
        if (nom) return `${nom}:${PORT_ECOUTE_WG}`;
        await new Promise((r) => setTimeout(r, 2500));
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Le numero de serie de la carte, ou `null` quand il n'y en a pas.
   *
   * Une machine sans carte RouterBOARD -- CHR, x86 -- n'en a pas, et la
   * requete echoue au lieu de rendre une chaine vide. L'echec est avale : un
   * raccordement qui a marche ne doit pas etre perdu pour un renseignement
   * accessoire.
   */
  private async numeroDeSerie(client: RouterOSRestClient): Promise<string | null> {
    try {
      const carte = await client.get<{ 'serial-number'?: string }>('/system/routerboard');
      return carte?.['serial-number']?.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * La cle publique que le routeur vient de produire pour son interface.
   *
   * Relue apres coup plutot que supposee : RouterOS la genere lui-meme a la
   * creation de l'interface, et c'est exactement ce qu'on veut — la cle
   * privee nait sur le routeur et n'en sort jamais, meme vers la console qui
   * pilote l'operation.
   */
  private async clePubliqueDuTunnel(client: RouterOSRestClient): Promise<string> {
    const interfaces = await client.get<{ name?: string; 'public-key'?: string }[]>(
      '/interface/wireguard',
    );
    const cle = interfaces.find((i) => i.name === INTERFACE_WG)?.['public-key'];
    if (!cle) {
      throw new BadRequestException(
        `L'interface « ${INTERFACE_WG} » a été créée mais n'annonce aucune clé publique. ` +
          `Vérifiez que le paquet « wireguard » est bien actif sur ce routeur.`,
      );
    }
    return cle;
  }

  /**
   * Le compte de service, et rien de plus.
   *
   * L'utilisateur part **avant** son groupe : RouterOS refuse de retirer un
   * groupe dont un utilisateur dépend encore, et l'ordre inverse échoue sur un
   * second passage.
   *
   * Le service `www-ssl` n'est volontairement pas restreint ici. Le faire
   * avant d'avoir éprouvé le tunnel a déjà coupé un routeur en essai :
   * `set www-ssl address=...` **remplace** la liste au lieu d'y ajouter. Le
   * resserrage est une étape séparée, proposée une fois le tunnel constaté —
   * et qui, à ce moment-là, peut être annulée par le tunnel lui-même.
   */
  private async poserLeCompte(client: RouterOSRestClient, motDePasse: string): Promise<void> {
    await this.nettoyer(client, '/user', (x) => x.name === COMPTE_API);
    await this.nettoyer(client, '/user/group', (x) => x.name === INTERFACE_WG);

    await client.put('/user/group', {
      name: INTERFACE_WG,
      policy: 'read,write,api,rest-api,test',
      comment: `${MARQUE} - lecture/ecriture HotSpot et User Manager`,
    });
    await client.put('/user', {
      name: COMPTE_API,
      group: INTERFACE_WG,
      password: motDePasse,
      comment: `${MARQUE} - compte applicatif`,
    });
  }

  /**
   * Retire ce qu'un passage précédent a laissé, et seulement cela.
   *
   * L'échec est avalé à dessein : sur un routeur vierge il n'y a rien à
   * retirer, et un menu absent — WireGuard sur une version trop ancienne —
   * ne doit pas ressembler à une panne. Ce qui compte vraiment, l'ajout qui
   * suit, échouera bruyamment s'il le faut.
   */
  private async nettoyer(
    client: RouterOSRestClient,
    chemin: string,
    correspond: (item: Record<string, unknown>) => boolean,
  ): Promise<void> {
    try {
      const existants = await client.get<Record<string, unknown>[]>(chemin);
      for (const item of existants.filter(correspond)) {
        const id = item['.id'];
        if (typeof id === 'string') {
          await client.delete(`${chemin}/${encodeURIComponent(id)}`);
        }
      }
    } catch (e) {
      this.logger.debug(`Rien à nettoyer sur ${chemin} : ${e instanceof Error ? e.message : e}`);
    }
  }

  /** L'adresse que le routeur devra rappeler, quand elle a déjà glissé. */
  private adresseDeRappelPerimee(): AdressePerimee | null {
    const rappel = this.config.get<string>('PUBLIC_BASE_URL');
    const hote = rappel ? hoteDeLUrl(rappel) : '';
    return (
      (hote ? adressePerimee(hote) : null) ??
      adressePerimee(this.wireguard.settings.endpointHost)
    );
  }

  /**
   * Un client jetable, bâti sur les identifiants fournis pour cet appel.
   *
   * Délibérément hors de `MikrotikClientFactory` : celle-ci lit les
   * identifiants **en base**, et c'est tout l'intérêt ici de ne pas les y
   * mettre. Ce client vit le temps d'une requête et n'est mis en cache nulle
   * part — sans quoi le mot de passe administrateur survivrait à l'appel
   * dans la mémoire du serveur.
   */
  private client(
    host: string,
    port: number,
    username: string,
    password: string,
    tlsFingerprint: string,
  ): RouterOSRestClient {
    return new RouterOSRestClient(
      {
        baseUrl: `https://${host}:${port}`,
        username,
        password,
        // L'empreinte vient d'être relevée sur ce même hôte : elle épingle le
        // certificat sans exiger qu'il soit signé par une autorité, ce qu'un
        // certificat de routeur n'est jamais.
        tlsFingerprint,
        rejectUnauthorized: false,
        timeoutMs: 10_000,
      },
      new ConsoleLogger('raccordement-assiste'),
    );
  }
}
