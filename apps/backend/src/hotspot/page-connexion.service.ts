import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * La page de connexion du portail captif : ce que l'exploitant règle, et ce
 * qu'il ne peut pas retirer.
 *
 * C'est le maillon qui manquait au parcours d'achat. Le Walled Garden
 * laissait déjà passer la page de paiement — l'entrée existe, avec le bon
 * port — mais **elle était comptée à zéro visite**, faute de lien : un client
 * sans code voyait une page qui ne lui proposait rien, et devait trouver le
 * vendeur.
 *
 * **Le bouton d'achat n'est pas dans ce que l'exploitant édite.** Il en
 * change les mots, jamais l'existence : le bloc est écrit par le serveur au
 * moment de publier. On ne supprime pas ce qu'on ne tient pas. Ce n'est pas
 * une protection contre l'exploitant — il possède son routeur, WinBox lui
 * ouvre le fichier, et aucun code ici ne l'en empêchera. C'est une garantie
 * sur ce que **cette console** écrit, doublée d'une détection quand la page
 * servie n'est plus celle qu'elle a publiée.
 *
 * **La page est un fichier statique.** Elle pourrait interroger
 * l'application pour afficher les offres, mais elle est servie depuis le
 * routeur : l'appel serait inter-origine et le navigateur le refuserait.
 * Surtout, une page de connexion ne doit avoir aucun mode de panne — si la
 * liste ne répond pas, plus personne ne se connecte.
 */

const ICI = dirname(fileURLToPath(import.meta.url));

/**
 * Le squelette, cherché depuis la racine du dépôt.
 *
 * Deux chemins parce que le code tourne depuis `src/` en développement et
 * depuis `dist/` une fois compilé : chercher au seul endroit du moment
 * marcherait chez soi et échouerait en production.
 */
const CHEMINS_MODELE = [
  resolve(ICI, '../../../../hotspot/login.html'),
  resolve(ICI, '../../../../../hotspot/login.html'),
];

/** Ce que RouterOS utilise quand un profil ne nomme pas de dossier. */
const DOSSIER_PAR_DEFAUT = 'hotspot';

/**
 * La page envoie le mot de passe en clair : c'est `http-pap`.
 *
 * Sans lui, publier cette page revient à fermer la porte à tout le monde —
 * clients payants compris. La page d'usine de MikroTik, elle, chiffre par
 * CHAP avec `md5.js` ; remplacer l'une par l'autre sans vérifier le profil
 * est le genre de geste qu'on ne rattrape qu'en se déplaçant sur site.
 */
const METHODE_REQUISE = 'http-pap';

/**
 * Ce qu'un logo embarqué a le droit de peser, en caractères.
 *
 * La page fait environ 9 400 octets et l'API du routeur en refuse plus de
 * 61 440 : il reste donc de la marge, mais pas infiniment. 40 000 caractères
 * de base64 valent à peu près 30 Ko d'image — largement de quoi loger une
 * vignette de 128 px, et pas de quoi faire passer une photo.
 *
 * La console réduit l'image avant de l'envoyer ; ce plafond n'est là que pour
 * le cas où elle serait contournée.
 */
const LOGO_MAX_CARACTERES = 40_000;

export interface ReglagesPageConnexion {
  titre: string;
  sousTitre: string;
  labelCode: string;
  libelleConnexion: string;
  libelleAchat: string;
  aideAchat: string;
  piedDePage: string;
  couleur: string;
  logoUrl: string | null;
  portailUrl: string;
  /** Où se trouve le local, tel qu'on l'explique à quelqu'un du quartier. */
  adresse: string;
  /** Les numéros, tels qu'ils se composent. */
  telephones: string;
  /** Page Facebook ou autre, en toutes lettres — jamais un lien. */
  reseauSocial: string;
  /** Afficher le tableau des tarifs, calculé depuis les offres réelles. */
  afficherTarifs: boolean;
  /** Le titre du tableau. La page de ce parc disait « SARANY (Tarifs) ». */
  titreTarifs: string;
  /** Les offres retirées de l'affiche — pas de la vente. */
  tarifsMasques: string[];
}

/** Une offre, telle que l'écran de réglage la propose de montrer ou non. */
export interface LigneTarif {
  id: string;
  nom: string;
  prix: string;
  duree: string;
  appareils: number | null;
  visible: boolean;
}

/**
 * Une adresse que le client captif pourrait atteindre.
 *
 * L'exploitant la tapait à la main, et personne ne lui disait laquelle. Elle
 * se déduit pourtant : la console connaît ses propres cartes réseau, le
 * routeur annonce l'adresse de son portail, et il suffit de garder celles qui
 * sont sur le même réseau — les cartes virtuelles d'un poste de travail
 * tombent d'elles-mêmes.
 */
export interface AdresseCandidate {
  url: string;
  /** D'où elle vient, pour que le choix se fasse en connaissance de cause. */
  source: 'reseau-local' | 'domaine';
  /** Le Walled Garden la laisse-t-il déjà passer ? */
  autorisee: boolean;
}

/** Une cible réelle : un dossier que sert au moins un serveur HotSpot. */
export interface CiblePublication {
  chemin: string;
  /** Les serveurs servis depuis ce dossier, pour que l'écran les nomme. */
  serveurs: string[];
  /** Vrai quand le profil accepte la méthode que la page utilise. */
  motDePasseEnClairAccepte: boolean;
  /** Ce que la console y a écrit la dernière fois, ou `null`. */
  publie: { octets: number; publieLe: Date } | null;
  /** Ce que le routeur porte aujourd'hui, ou `null` si le fichier manque. */
  surLeRouteur: { octets: number | null; modifieLe: string | null } | null;
  /**
   * Le fichier s'écarte-t-il des autres fichiers d'usine du même dossier ?
   *
   * Ils portent tous la seconde où le HotSpot a été installé. Un `login.html`
   * daté autrement a été remplacé — par la console, ou à la main dans WinBox.
   * C'est le seul moyen de le savoir sans lire le fichier, que RouterOS ne
   * rend que sous 4 096 octets.
   */
  modifieeHorsConsole: boolean;
}

/**
 * Ce qui décide, à cet instant, si un client peut acheter.
 *
 * Quatre choses doivent être d'accord, et elles bougent séparément :
 * l'adresse gravée dans la page du routeur, l'adresse où la console répond
 * vraiment, ce que le Walled Garden laisse passer, et l'existence d'une offre
 * et d'une puce. Aucune n'est vérifiée par les trois autres.
 *
 * Le jour où elles divergent, personne ne l'apprend : le client tape sur un
 * bouton mort, conclut que le réseau ne marche pas, et s'en va. Il ne
 * téléphone pas pour signaler un bouton.
 */
export interface SanteParcoursAchat {
  /** Vrai quand un client peut acheter maintenant. */
  operationnel: boolean;
  /** Ce qui l'empêche, dit dans l'ordre où cela se corrige. */
  ruptures: string[];
  /** L'adresse gravée dans la page publiée, ou `null` si jamais publiée. */
  adressePubliee: string | null;
  /** Celle où la console répond aujourd'hui, si elle a pu être déduite. */
  adresseActuelle: string | null;
}

export interface EtatPageConnexion {
  reglages: ReglagesPageConnexion;
  /** `true` tant que l'exploitant n'a rien enregistré : tout vient des défauts. */
  parDefaut: boolean;
  /** Les offres à ticket actives, et si l'affiche les montre. */
  tarifs: LigneTarif[];
  /** Les adresses que le client captif pourrait atteindre, déduites. */
  adresses: AdresseCandidate[];
  cibles: CiblePublication[];
  /** Ce qui empêche de publier. Vide, la publication est possible. */
  empechements: string[];
  /** Ce qui mérite d'être lu avant de publier, sans l'empêcher. */
  avertissements: string[];
  sante: SanteParcoursAchat;
}

@Injectable()
export class PageConnexionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly clients: MikrotikClientFactory,
    private readonly audit: AuditService,
  ) {}

  /**
   * Les adresses IPv4 de cette machine, cartes internes exclues.
   *
   * Propriete et non appel direct, pour un seul motif : sans ce point de
   * reprise, la verification de sante depend du bail DHCP du poste qui
   * execute la suite. Le test passait a `192.168.88.135` et echouait le
   * lendemain a `192.168.88.23` — en decrivant mot pour mot la panne qu'il
   * est cense detecter, ce qui est la pire facon d'echouer : on croit avoir
   * casse le code alors que c'est la machine qui a change d'adresse.
   */
  adressesDeLaMachine: () => string[] = adressesLocales;

  private async modele(): Promise<string> {
    for (const chemin of CHEMINS_MODELE) {
      try {
        return sansDocumentation(await readFile(chemin, 'utf8'));
      } catch {
        /* essai suivant */
      }
    }
    throw new NotFoundException(
      'Le modèle de page de connexion est introuvable (hotspot/login.html)',
    );
  }

  /**
   * Les réglages de l'exploitant, complétés par les défauts.
   *
   * Rien n'est créé en base tant qu'il n'a rien enregistré : une ligne vide
   * ferait croire à un réglage alors que c'est le défaut qui s'applique.
   */
  async reglages(): Promise<{ reglages: ReglagesPageConnexion; parDefaut: boolean }> {
    const tenantId = this.tenantContext.requireTenantId();
    const [tenant, ligne] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { slug: true, wifiName: true, name: true },
      }),
      this.prisma.hotspotLoginPage.findUnique({ where: { tenantId } }),
    ]);
    if (!tenant) throw new NotFoundException('Exploitant introuvable');

    return {
      parDefaut: ligne === null,
      reglages: {
        titre: ligne?.titre ?? tenant.wifiName,
        sousTitre:
          ligne?.sousTitre ?? "Entrez le code reçu après votre achat pour accéder à Internet.",
        // Pas réglable, et c'est voulu : ce libellé décrit ce qu'il faut
        // taper, il n'appartient pas à la marque. Le rendre modifiable
        // ouvrirait la porte à un champ qui ne dit plus ce qu'il attend.
        labelCode: "Code d'accès ou nom",
        libelleConnexion: ligne?.libelleConnexion ?? 'Se connecter',
        libelleAchat: ligne?.libelleAchat ?? 'Acheter un accès',
        aideAchat: ligne?.aideAchat ?? 'Payez par Mobile Money, sans quitter le Wi-Fi.',
        piedDePage: ligne?.piedDePage ?? tenant.name,
        couleur: ligne?.couleur ?? '#0284c7',
        logoUrl: ligne?.logoUrl ?? null,
        portailUrl: ligne?.portailUrl ?? '',
        adresse: ligne?.adresse ?? '',
        telephones: ligne?.telephones ?? '',
        reseauSocial: ligne?.reseauSocial ?? '',
        // Vrai par défaut : une page de connexion sans prix oblige le client
        // à demander, ce qui est exactement ce qu'on cherche à supprimer.
        afficherTarifs: ligne?.afficherTarifs ?? true,
        titreTarifs: ligne?.titreTarifs ?? 'Tarifs',
        tarifsMasques: ligne?.tarifsMasques ?? [],
      },
    };
  }

  /** Enregistre les réglages. Rien n'est envoyé au routeur ici. */
  async enregistrer(
    dto: Partial<ReglagesPageConnexion>,
    adminUserId: string,
  ): Promise<{ reglages: ReglagesPageConnexion; parDefaut: boolean }> {
    const tenantId = this.tenantContext.requireTenantId();

    if (dto.couleur !== undefined && dto.couleur !== null) {
      exigerCouleurLisible(dto.couleur);
    }
    if (dto.logoUrl) exigerLogoUtilisable(dto.logoUrl);

    const donnees = {
      titre: dto.titre ?? null,
      sousTitre: dto.sousTitre ?? null,
      libelleConnexion: dto.libelleConnexion ?? null,
      libelleAchat: dto.libelleAchat ?? null,
      aideAchat: dto.aideAchat ?? null,
      piedDePage: dto.piedDePage ?? null,
      couleur: dto.couleur ?? null,
      logoUrl: dto.logoUrl || null,
      portailUrl: dto.portailUrl?.trim().replace(/\/+$/, '') || null,
      adresse: dto.adresse ?? null,
      telephones: dto.telephones ?? null,
      reseauSocial: dto.reseauSocial ?? null,
      // Le formulaire envoie « true »/« false » en chaîne quand il passe par
      // la requête : un test de vérité brut ferait de « false » un oui.
      afficherTarifs: dto.afficherTarifs === undefined ? true : `${dto.afficherTarifs}` !== 'false',
      titreTarifs: dto.titreTarifs ?? null,
      tarifsMasques: Array.isArray(dto.tarifsMasques) ? dto.tarifsMasques : [],
    };

    await this.prisma.hotspotLoginPage.upsert({
      where: { tenantId },
      create: { tenantId, ...donnees },
      update: donnees,
    });

    await this.audit.log({
      adminUserId,
      action: 'SET_LOGIN_PAGE',
      targetType: 'Tenant',
      targetId: tenantId,
      payloadDiff: { portail: donnees.portailUrl, couleur: donnees.couleur },
    });

    return this.reglages();
  }

  /**
   * Le HTML tel qu'il sera écrit, sans rien envoyer.
   *
   * Prévisualiser avant d'écraser n'est pas un luxe : une page fautive sur le
   * routeur, et **plus personne ne se connecte** — ni les clients déjà
   * payants, ni ceux qui viennent d'acheter.
   */
  async apercu(remplace?: Partial<ReglagesPageConnexion>): Promise<{
    contenu: string;
    octets: number;
  }> {
    const tenantId = this.tenantContext.requireTenantId();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true, currency: true },
    });
    if (!tenant) throw new NotFoundException('Exploitant introuvable');

    const { reglages } = await this.reglages();
    // Le booléen se traite à part : il arrive de la requête en toutes lettres
    // (« false »), et `nettoyer` ne garde que des chaînes destinées à des
    // marqueurs. Sans cette ligne, décocher les tarifs n'aurait aucun effet
    // sur l'aperçu — on décoche, rien ne bouge, on conclut que c'est cassé.
    const tarifsDemandes =
      remplace?.afficherTarifs === undefined
        ? reglages.afficherTarifs
        : `${remplace.afficherTarifs}` !== 'false';
    // Meme raison pour la liste des offres masquees : c'est un tableau, et
    // `nettoyer` ne garde que des chaines. Sans cette ligne, decocher une
    // ligne ne changerait rien a l'apercu -- on decoche, le tableau ne bouge
    // pas, et on conclut que le reglage ne marche pas.
    const masquees = Array.isArray(remplace?.tarifsMasques)
      ? remplace.tarifsMasques
      : reglages.tarifsMasques;
    const r = {
      ...reglages,
      ...nettoyer(remplace),
      afficherTarifs: tarifsDemandes,
      tarifsMasques: masquees,
    };

    /**
     * Les tarifs, lus là où ils se vendent.
     *
     * Exactement la règle de la page de paiement — offres actives à ticket —
     * pour que l'affiche du portail et la vitrine du client ne puissent plus
     * diverger. Sur ce parc, celle écrite à la main annonçait « 1 Ora » pour
     * 500 Ar alors que le routeur en donne deux, proposait une offre à
     * 30 000 Ar qui n'existe pas, et taisait les 4 h à 1 000 Ar.
     */
    const offres = r.afficherTarifs
      ? (
          await this.prisma.scopedStrict.plan.findMany({
            where: { status: 'ACTIVE', kind: 'TICKET' },
            select: {
              id: true,
              name: true,
              price: true,
              validityDurationSeconds: true,
              maxSharedUsers: true,
            },
            orderBy: { price: 'asc' },
          })
        ).filter((o) => !r.tarifsMasques.includes(o.id))
      : [];

    // Une barre finale se glisse une fois sur deux dans un champ d'adresse,
    // et donnerait « http://hote//p/slug ».
    const portail = (r.portailUrl ?? '').trim().replace(/\/+$/, '');

    const contenu = (await this.modele())
      .replaceAll('__MARQUE__', echapper(r.titre))
      .replaceAll('__SOUS_TITRE__', echapper(r.sousTitre))
      .replaceAll('__LABEL_CODE__', echapper(r.labelCode))
      .replaceAll('__LIBELLE_CONNEXION__', echapper(r.libelleConnexion))
      .replaceAll('__LIBELLE_ACHAT__', echapper(r.libelleAchat))
      .replaceAll('__AIDE_ACHAT__', echapper(r.aideAchat))
      .replaceAll('__COULEUR__', couleurSure(r.couleur))
      .replaceAll('__BLOC_LOGO__', blocLogo(r.logoUrl))
      .replaceAll('__BLOC_TARIFS__', blocTarifs(offres, tenant.currency, r.titreTarifs))
      .replaceAll('__BLOC_PIED__', blocPied(r))
      .replaceAll('__LIEU__', echapper(r.piedDePage))
      .replaceAll('__PORTAIL__', echapper(portail))
      .replaceAll('__SLUG__', echapper(tenant.slug));

    return { contenu, octets: contenu.length };
  }

  /**
   * Où la page doit être écrite, et ce qui s'y oppose.
   *
   * **Le chemin était en dur.** `flash/hotspot/login.html` se trouve être
   * juste sur ce parc — le profil qui sert vraiment y pointe — mais le profil
   * `default` du même routeur sert depuis `hotspot`. Chez un exploitant dont
   * le serveur utilise `default`, la console écrivait un fichier **que
   * personne ne sert**, en annonçant « page écrite, 6 000 octets ». Un succès
   * affiché pour un geste sans effet est la pire panne possible : on cherche
   * la cause partout sauf là.
   */
  async etat(
    routerId?: string,
    portailSaisi?: string,
    portConsole?: string,
  ): Promise<EtatPageConnexion> {
    const tenantId = this.tenantContext.requireTenantId();
    const { reglages: enregistres, parDefaut } = await this.reglages();
    // L'adresse en cours de saisie prime sur celle enregistree : sans cela,
    // le piege du `dns-name` ne se revelerait qu'apres avoir enregistre, et
    // l'exploitant decouvrirait le refus une fois tout regle.
    const reglages = portailSaisi
      ? { ...enregistres, portailUrl: portailSaisi.trim().replace(/\/+$/, '') }
      : enregistres;

    const mikrotik = routerId
      ? await this.clients.forRouter(routerId)
      : await this.clients.forDefaultRouter();

    const [
      serveurs,
      profils,
      fichiers,
      wgHotes,
      wgAdresses,
      publications,
      offres,
      exploitant,
      puces,
    ] = await Promise.all([
      mikrotik.getHotspotServers(),
      mikrotik.getHotspotServerProfiles(),
      mikrotik.getRouterFiles(),
      // « Doit figurer dans le Walled Garden » est un conseil ; le lire est un
      // constat. La différence se paie en heures de recherche le jour où le
      // bouton ne mène nulle part.
      mikrotik.getWalledGarden().catch(() => []),
      mikrotik.getWalledGardenIps().catch(() => []),
      routerId
        ? this.prisma.hotspotLoginPublication.findMany({ where: { tenantId, routerId } })
        : Promise.resolve([]),
      this.prisma.scopedStrict.plan.findMany({
        where: { status: 'ACTIVE', kind: 'TICKET' },
        select: {
          id: true,
          name: true,
          price: true,
          validityDurationSeconds: true,
          maxSharedUsers: true,
        },
        orderBy: { price: 'asc' },
      }),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { currency: true, domains: true },
      }),
      // Sans puce enregistree, la page de paiement montre les prix puis un
      // ecran qui n'a aucun numero a donner : le parcours s'arrete la, et le
      // client a deja traverse deux pages pour rien.
      this.prisma.scopedStrict.mobileMoneyAccount.count({ where: { isActive: true } }),
    ]);

    const profilPar = new Map(profils.map((p) => [p.name, p]));
    const parDossier = new Map<string, { serveurs: string[]; pap: boolean }>();

    for (const serveur of serveurs) {
      // Un serveur désactivé ne sert rien : l'inclure ferait publier dans un
      // dossier que personne ne lit, et c'est exactement ce qu'on corrige.
      if (serveur.disabled) continue;
      const profil = serveur.profileName ? profilPar.get(serveur.profileName) : undefined;
      const dossier = (profil?.htmlDirectory || DOSSIER_PAR_DEFAUT).replace(/\/+$/, '');
      const entree = parDossier.get(dossier) ?? { serveurs: [], pap: true };
      entree.serveurs.push(serveur.name);
      // Il suffit qu'un seul profil refuse le mot de passe en clair pour que
      // la page casse la connexion des clients de ce serveur-là.
      entree.pap = entree.pap && (profil?.loginBy ?? []).includes(METHODE_REQUISE);
      parDossier.set(dossier, entree);
    }

    const cibles: CiblePublication[] = [...parDossier.entries()].map(([dossier, e]) => {
      const chemin = `${dossier}/login.html`;
      const surLeRouteur = fichiers.find((f) => f.name === chemin) ?? null;
      const publie = publications.find((p) => p.chemin === chemin) ?? null;
      // `logout.html` sert de témoin : personne ne le remplace, et il porte
      // donc la seconde d'installation du HotSpot.
      const temoin = fichiers.find((f) => f.name === `${dossier}/logout.html`) ?? null;
      return {
        chemin,
        serveurs: e.serveurs,
        modifieeHorsConsole: Boolean(
          surLeRouteur?.lastModified &&
            temoin?.lastModified &&
            surLeRouteur.lastModified !== temoin.lastModified,
        ),
        motDePasseEnClairAccepte: e.pap,
        publie: publie ? { octets: publie.octets, publieLe: publie.publieLe } : null,
        surLeRouteur: surLeRouteur
          ? { octets: surLeRouteur.sizeBytes, modifieLe: surLeRouteur.lastModified }
          : null,
      };
    });

    /**
     * Les noms et adresses par lesquels le routeur se designe lui-meme.
     *
     * Pour un client non connecte, ils menent au portail captif. Une page de
     * paiement logee derriere l'un d'eux renverrait le client sur l'ecran
     * qu'il vient de quitter, en boucle : ils sont donc refuses comme
     * adresse, et jamais proposes -- proposer ce qu'on refuse ensuite est une
     * facon de faire perdre son temps a quelqu'un.
     */
    const nomsDuPortail = new Set(
      profils
        .flatMap((p) => [p.dnsName, p.hotspotAddress])
        .filter((n): n is string => Boolean(n) && n !== '0.0.0.0')
        .map((n) => n.toLowerCase()),
    );

    const empechements: string[] = [];
    const avertissements: string[] = [];

    if (cibles.length === 0) {
      empechements.push(
        "Aucun serveur HotSpot actif sur ce routeur : la page ne serait servie à personne.",
      );
    }
    for (const c of cibles.filter((c) => !c.motDePasseEnClairAccepte)) {
      empechements.push(
        `Le profil qui sert ${c.serveurs.join(', ')} n'accepte pas « ${METHODE_REQUISE} ». Cette page envoie le mot de passe en clair : publier la rendrait la connexion impossible, y compris pour vos clients déjà payants.`,
      );
    }

    const portail = reglages.portailUrl.trim();
    if (!portail) {
      empechements.push(
        "L'adresse de la page de paiement n'est pas renseignée : le bouton d'achat ne mènerait nulle part.",
      );
    } else {
      const hote = hoteDe(portail);
      if (hote && nomsDuPortail.has(hote)) {
        empechements.push(
          `« ${hote} » est l'adresse du portail captif lui-même : pour un client non connecté, ce nom mène au routeur. Le bouton d'achat le renverrait sur la page qu'il vient de quitter, en boucle.`,
        );
      }
      const verdict = autoriseParLeWalledGarden(portail, wgHotes, wgAdresses);
      if (!verdict.autorise) {
        avertissements.push(
          `« ${portail} » n'apparaît pas dans le Walled Garden : un client non connecté ne pourra pas l'atteindre, et le bouton d'achat ne mènera nulle part.${
            verdict.voisines.length > 0
              ? ` Les entrées présentes visent ${verdict.voisines.join(', ')} — vérifiez si ce n'est pas l'adresse que cette machine portait avant.`
              : ''
          }`,
        );
      }
    }

    if (reglages.logoUrl) {
      avertissements.push(
        "Le logo est chargé depuis le réseau : son adresse doit elle aussi être autorisée dans le Walled Garden, sinon il ne s'affichera pas.",
      );
    }

    for (const c of cibles.filter((c) => c.publie && c.surLeRouteur)) {
      if (c.surLeRouteur!.octets !== c.publie!.octets) {
        avertissements.push(
          `La page servie depuis ${c.chemin} ne fait pas la taille de celle que la console a publiée (${c.surLeRouteur!.octets} octets contre ${c.publie!.octets}) : elle a été remplacée depuis, probablement par WinBox.`,
        );
      }
    }

    /**
     * Les adresses que le client captif pourrait atteindre.
     *
     * L'exploitant les tapait à la main, et rien ne lui disait laquelle
     * prendre — alors qu'elles se déduisent. La console connaît ses propres
     * cartes réseau ; le routeur annonce l'adresse de son portail ; on garde
     * celles qui sont sur le même réseau. Les cartes virtuelles d'un poste de
     * travail (Hyper-V, WSL) tombent d'elles-mêmes, et c'est bien le but :
     * elles sont injoignables depuis le Wi-Fi.
     */
    const reseauxPortail = profils
      .map((p) => p.hotspotAddress)
      .filter((a): a is string => Boolean(a) && a !== '0.0.0.0');

    const port = portConsole && /^\d+$/.test(portConsole) ? `:${portConsole}` : '';
    const adresses: AdresseCandidate[] = [
      ...this.adressesDeLaMachine()
        .filter((ip) => reseauxPortail.some((portail) => memeReseau24(ip, portail)))
        .map((ip) => ({ url: `http://${ip}${port}`, source: 'reseau-local' as const })),
      // Le domaine de l'exploitant marche aussi, s'il pointe vers la console
      // et qu'il est autorisé : c'est la forme qui survit à un changement
      // d'adresse, puisque la page n'en porte plus aucune.
      ...(exploitant?.domains ?? [])
        // Le domaine de ce parc, `wifitati.net`, est aussi le `dns-name` du
        // profil HotSpot : le proposer reviendrait a proposer le routeur.
        .filter((d) => !nomsDuPortail.has(d.toLowerCase()))
        .map((d) => ({ url: `http://${d}`, source: 'domaine' as const })),
    ].map((c) => ({
      ...c,
      autorisee: autoriseParLeWalledGarden(c.url, wgHotes, wgAdresses).autorise,
    }));

    /**
     * Le diagnostic du parcours d'achat, dans l'ordre où il se corrige.
     *
     * Chaque rupture est une phrase qui dit **ce que le client voit**, pas
     * l'état d'un champ : « le bouton ne mène nulle part » se comprend et se
     * corrige, « portailUrl ne correspond pas » ne se comprend pas.
     */
    const publiee = publications.find((p) => p.portailUrl) ?? null;
    const adressePubliee = publiee?.portailUrl ?? null;
    const adresseActuelle = adresses.find((a) => a.source === 'reseau-local')?.url ?? null;

    const ruptures: string[] = [];
    if (cibles.length === 0) {
      ruptures.push("Aucun serveur HotSpot actif : vos clients ne voient aucune page.");
    } else if (publications.length === 0) {
      /**
       * Rien n'a été publié **depuis la console** — ce qui ne veut pas dire
       * qu'il n'y a pas de page.
       *
       * Le fichier a pu être déposé à la main dans WinBox, et c'est même le
       * seul chemin praticable pour une page riche : l'API du routeur refuse
       * tout octet au-dessus de 127. Annoncer « vos clients n'ont pas de
       * bouton » serait alors faux, en rouge, sur l'écran du matin — et une
       * fausse alerte s'apprend à s'ignorer.
       *
       * On peut trancher sans lire le fichier : RouterOS n'en rend le contenu
       * que sous 4 096 octets, mais les fichiers d'usine portent **tous la
       * même seconde**, celle de l'installation du HotSpot. Si `login.html`
       * s'en écarte, quelqu'un l'a remplacé.
       */
      const posees = cibles.filter((c) => c.surLeRouteur && c.modifieeHorsConsole);
      if (posees.length === cibles.length && posees.length > 0) {
        avertissements.push(
          "La page du routeur a été remplacée en dehors de la console. Son contenu n'est pas lisible — RouterOS ne rend un fichier que sous 4 096 octets : vérifiez vous-même qu'elle porte le bouton d'achat et qu'il vise la bonne adresse.",
        );
      } else {
        ruptures.push(
          "La page de connexion n'a jamais été publiée : vos clients voient celle d'origine du routeur, qui n'a pas de bouton d'achat.",
        );
      }
    } else if (
      adressePubliee &&
      adresseActuelle &&
      // Les **hotes** sont compares, pas les adresses entieres. Ce qu'on
      // traque est un demenagement de la machine -- un bail DHCP renouvele --
      // et le port, lui, ne bouge pas tout seul. Comparer l'adresse entiere
      // ferait crier au loup des que l'appelant omet le port, et une fausse
      // alerte est pire que pas d'alerte : on apprend a l'ignorer.
      hoteDe(adressePubliee) !== hoteDe(adresseActuelle)
    ) {
      // Le cas qui coûte le plus cher, parce qu'il survient tout seul : un
      // bail DHCP renouvelé suffit. Le fichier, lui, vit sur le routeur et ne
      // peut pas réagir.
      ruptures.push(
        `La page publiée envoie vos clients sur ${adressePubliee}, mais la console répond sur ${adresseActuelle}. Leur navigateur affiche « connexion refusée ». Republiez la page.`,
      );
    }

    const aVerifier = adressePubliee ?? reglages.portailUrl;
    if (aVerifier && !autoriseParLeWalledGarden(aVerifier, wgHotes, wgAdresses).autorise) {
      ruptures.push(
        `${aVerifier} n'est pas autorisée dans le Walled Garden : le routeur refuse la connexion de vos clients avant qu'elle n'arrive.`,
      );
    }
    if (offres.length === 0) {
      ruptures.push("Aucune offre à ticket active : la page de paiement n'a rien à vendre.");
    }
    if (puces === 0) {
      ruptures.push(
        "Aucune puce Mobile Money enregistrée : la page de paiement n'a aucun numéro à donner.",
      );
    }

    return {
      reglages,
      parDefaut,
      cibles,
      empechements,
      avertissements,
      sante: {
        operationnel: ruptures.length === 0,
        ruptures,
        adressePubliee,
        adresseActuelle,
      },
      adresses,
      tarifs: offres.map((o) => ({
        id: o.id,
        nom: o.name,
        prix: `${Number(o.price).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} ${
          exploitant?.currency ?? ''
        }`.trim(),
        duree: duree(o.validityDurationSeconds),
        appareils: o.maxSharedUsers,
        visible: !reglages.tarifsMasques.includes(o.id),
      })),
    };
  }

  /**
   * Remet d'accord les trois choses qui décident si un client peut acheter.
   *
   * L'adresse où la console répond, ce que le Walled Garden laisse passer, et
   * l'adresse gravée dans la page du routeur. Elles bougent séparément, et
   * rien ne les vérifie l'une par l'autre : un bail DHCP renouvelé pendant la
   * nuit suffit à les faire diverger. Le client, lui, tape sur un bouton mort
   * au matin, conclut que le réseau ne marche pas, et s'en va — il ne
   * téléphone pas pour signaler un bouton.
   *
   * Trois gestes, dans cet ordre, chacun sauté s'il n'a rien à faire : retenir
   * l'adresse où la console répond, l'ouvrir dans le Walled Garden, republier
   * la page pour qu'elle la porte.
   *
   * **Ce n'est pas automatique, et ce serait une erreur que ça le soit** :
   * republier écrase la page que voient les clients, et ouvrir le Walled
   * Garden perce un passage vers une machine. L'application constate et
   * propose ; l'exploitant décide.
   */
  async reparer(adminUserId: string, routerId?: string): Promise<{ gestes: string[] }> {
    const avant = await this.etat(routerId);
    const gestes: string[] = [];

    const cible = avant.sante.adresseActuelle;
    if (!cible) {
      throw new BadRequestException(
        "Aucune adresse n'a pu être déduite : la console ne répond sur aucune carte réseau du réseau de ce portail. Saisissez l'adresse à la main.",
      );
    }

    if (avant.reglages.portailUrl !== cible) {
      await this.enregistrer({ ...avant.reglages, portailUrl: cible }, adminUserId);
      gestes.push(`Adresse de paiement réglée sur ${cible}`);
    }

    // L'autorisation est lue dans l'état déjà calculé : la recalculer sur des
    // listes vides répondrait « non » à tous les coups, et ajouterait une
    // règle de plus à chaque réparation.
    const dejaOuverte = avant.adresses.find((a) => a.url === cible)?.autorisee ?? false;
    if (!dejaOuverte) {
      const mikrotik = routerId
        ? await this.clients.forRouter(routerId)
        : await this.clients.forDefaultRouter();
      const u = new URL(cible);
      await mikrotik.createWalledGardenIpEntry({
        dstAddress: u.hostname,
        // Le port de l'adresse, et lui seul : ouvrir toute la machine pour
        // servir une page ouvrirait bien plus large que nécessaire.
        dstPort: u.port || undefined,
        action: 'accept',
        comment: 'Page de paiement GeMikrot',
      });
      gestes.push(`${cible} autorisée dans le Walled Garden`);
    }

    const { ecrits } = await this.publier(adminUserId, routerId);
    gestes.push(`Page republiée dans ${ecrits.map((e) => e.chemin).join(', ')}`);

    await this.audit.log({
      adminUserId,
      routerId,
      action: 'REPAIR_PURCHASE_PATH',
      targetType: 'Router',
      targetId: routerId ?? 'defaut',
      payloadDiff: { gestes },
    });

    return { gestes };
  }

  /**
   * Écrit la page sur chaque dossier réellement servi.
   *
   * Le geste ne se défait pas : RouterOS ne garde aucune version précédente
   * d'un fichier remplacé.
   */
  async publier(
    adminUserId: string,
    routerId?: string,
  ): Promise<{ ecrits: { chemin: string; octets: number }[] }> {
    const tenantId = this.tenantContext.requireTenantId();
    const etat = await this.etat(routerId);

    if (etat.empechements.length > 0) {
      throw new BadRequestException(etat.empechements.join(' '));
    }

    const { contenu, octets } = await this.apercu();
    const mikrotik = routerId
      ? await this.clients.forRouter(routerId)
      : await this.clients.forDefaultRouter();

    const ecrits: { chemin: string; octets: number }[] = [];
    for (const cible of etat.cibles) {
      await mikrotik.writeRouterFile(cible.chemin, contenu);
      ecrits.push({ chemin: cible.chemin, octets });

      if (routerId) {
        await this.prisma.hotspotLoginPublication.upsert({
          where: { routerId_chemin: { routerId, chemin: cible.chemin } },
          create: {
            tenantId,
            routerId,
            chemin: cible.chemin,
            octets,
            portailUrl: etat.reglages.portailUrl,
            publiePar: adminUserId,
          },
          update: {
            octets,
            portailUrl: etat.reglages.portailUrl,
            publieLe: new Date(),
            publiePar: adminUserId,
          },
        });
      }
    }

    await this.audit.log({
      adminUserId,
      routerId,
      action: 'PUBLISH_LOGIN_PAGE',
      targetType: 'Router',
      targetId: routerId ?? 'defaut',
      payloadDiff: { chemins: ecrits.map((e) => e.chemin), octets },
    });

    return { ecrits };
  }
}

/**
 * Retire le commentaire de documentation en tête du modèle.
 *
 * Il **liste les marqueurs**, et `replaceAll` les y remplaçait aussi : le
 * tableau des tarifs se retrouvait écrit une seconde fois à l'intérieur d'un
 * commentaire. Invisible pour le client, mais 2 800 octets de plus dans un
 * fichier qui voyage par une API plafonnée à 61 440 — et surtout, la preuve
 * qu'on sert au client une page dont une partie ne le concerne pas.
 *
 * Ce commentaire explique le modèle à qui le lit dans le dépôt ; il n'a rien
 * à faire sur le routeur.
 */
function sansDocumentation(modele: string): string {
  const debut = modele.indexOf('<!--');
  if (debut === -1 || !modele.slice(debut, debut + 200).includes('Page captive HotSpot')) {
    return modele;
  }
  const fin = modele.indexOf('-->', debut);
  if (fin === -1) return modele;
  // Cherche par indices plutot que par expression reguliere : le commentaire
  // fait trente lignes, et une reguliere qui traverse autant de sauts de ligne
  // se relit mal pour ce qu'elle fait -- trouver deux bornes.
  return (modele.slice(0, debut) + modele.slice(fin + 3)).replace(/^\s*\n/, '');
}

/** Les seuls champs qu'un aperçu peut remplacer. */
const CHAMPS = [
  'titre',
  'sousTitre',
  'libelleConnexion',
  'libelleAchat',
  'aideAchat',
  'piedDePage',
  'couleur',
  'logoUrl',
  'portailUrl',
  'adresse',
  'telephones',
  'reseauSocial',
  'titreTarifs',
] as const;

/**
 * Ce que l'aperçu retient de ce qu'on lui passe.
 *
 * Liste blanche plutôt que filtrage : la requête porte aussi `routerId`, et
 * demain d'autres paramètres. Les laisser entrer dans les réglages ne casse
 * rien aujourd'hui — aucun marqueur ne leur correspond — et c'est exactement
 * le genre de laisser-passer dont on ne se souvient plus le jour où un nom
 * finit par coïncider.
 *
 * Un champ vide est ignoré, pas appliqué : il écraserait un réglage
 * enregistré par du vide pendant qu'on efface le champ pour le retaper.
 */
function nettoyer(
  partiel?: Partial<ReglagesPageConnexion>,
): Partial<ReglagesPageConnexion> {
  if (!partiel) return {};
  const gardes: Partial<ReglagesPageConnexion> = {};
  for (const champ of CHAMPS) {
    const valeur = partiel[champ];
    if (typeof valeur === 'string' && valeur !== '') {
      (gardes as Record<string, string>)[champ] = valeur;
    }
  }
  return gardes;
}

/** Les adresses IPv4 de la machine, cartes internes exclues. */
function adressesLocales(): string[] {
  const trouvees: string[] = [];
  for (const liste of Object.values(networkInterfaces())) {
    for (const carte of liste ?? []) {
      if (carte.family === 'IPv4' && !carte.internal) trouvees.push(carte.address);
    }
  }
  return trouvees;
}

/**
 * Deux adresses sur le même /24 ?
 *
 * Le masque réel n'est pas lu : celui de la console ne dit rien de celui du
 * routeur, et un HotSpot de quartier tient dans un /24. Une supposition, mais
 * une supposition qui ne décide de rien — elle ne fait que **proposer** une
 * adresse, que l'exploitant confirme ou remplace.
 */
export function memeReseau24(a: string, b: string): boolean {
  const ta = a.split('.');
  const tb = b.split('.');
  if (ta.length !== 4 || tb.length !== 4) return false;
  return ta[0] === tb[0] && ta[1] === tb[1] && ta[2] === tb[2];
}

/**
 * Cette adresse passe-t-elle le Walled Garden ?
 *
 * Deux tables, et il suffit de l'une : `walled-garden` filtre par nom d'hôte,
 * `walled-garden-ip` par adresse et port. Une entrée désactivée ne compte
 * pas — elle est là, elle ne sert pas, et c'est précisément le genre de
 * détail qui fait conclure « pourtant je l'ai autorisée ».
 *
 * `voisines` rend les adresses autorisées qui ne correspondent pas : sur ce
 * parc, le Walled Garden vise `192.168.88.250` alors que la console répond
 * sur `.135`. Nommer l'écart vaut mieux que dire « ce n'est pas autorisé ».
 */
export function autoriseParLeWalledGarden(
  portail: string,
  hotes: { dstHost: string | null; action: string; disabled: boolean }[],
  adresses: { dstAddress: string | null; dstPort: string | null; action: string; disabled: boolean }[],
): { autorise: boolean; voisines: string[] } {
  const hote = hoteDe(portail);
  if (!hote) return { autorise: false, voisines: [] };

  let port = '';
  try {
    port = new URL(portail.includes('://') ? portail : `http://${portail}`).port;
  } catch {
    /* sans port explicite */
  }

  const parNom = hotes.some(
    (h) => !h.disabled && h.action === 'allow' && (h.dstHost ?? '').toLowerCase() === hote,
  );

  const parAdresse = adresses.some((a) => {
    if (a.disabled || a.action !== 'accept') return false;
    if ((a.dstAddress ?? '') !== hote) return false;
    // Une règle sans port couvre tous les ports.
    return !a.dstPort || !port || a.dstPort.split(',').includes(port);
  });

  const voisines = [
    ...new Set(
      [
        ...hotes.filter((h) => !h.disabled && h.dstHost).map((h) => h.dstHost as string),
        ...adresses
          .filter((a) => !a.disabled && a.dstAddress)
          .map((a) => `${a.dstAddress}${a.dstPort ? `:${a.dstPort}` : ''}`),
      ].filter((v) => !v.startsWith(hote)),
    ),
  ];

  return { autorise: parNom || parAdresse, voisines };
}

/** L'hôte d'une adresse, en minuscules, sans port. `''` si illisible. */
export function hoteDe(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `http://${url}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Une couleur d'accent qui reste lisible.
 *
 * Elle porte du texte blanc sur le bouton de connexion. Une couleur claire
 * choisie de bonne foi — un jaune de marque, par exemple — rendrait ce bouton
 * illisible, et cette page-là se lit au soleil, sur un téléphone. Le seuil
 * est celui de l'AA pour du texte large : 3:1.
 */
export function contrasteAvecBlanc(couleur: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(couleur.trim());
  if (!m) return 0;
  const canal = (n: number) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const v = m[1];
  const L =
    0.2126 * canal(parseInt(v.slice(0, 2), 16)) +
    0.7152 * canal(parseInt(v.slice(2, 4), 16)) +
    0.0722 * canal(parseInt(v.slice(4, 6), 16));
  return 1.05 / (L + 0.05);
}

export function exigerCouleurLisible(couleur: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(couleur.trim())) {
    throw new BadRequestException('La couleur doit s’écrire #RRGGBB, par exemple #0284c7.');
  }
  const contraste = contrasteAvecBlanc(couleur);
  if (contraste < 3) {
    throw new BadRequestException(
      `Cette couleur porte du texte blanc et ne rend que ${contraste.toFixed(1)}:1 — le bouton « Se connecter » serait illisible. Choisissez-en une plus sombre (3:1 au minimum).`,
    );
  }
}

/** Repli silencieux : l'aperçu ne doit jamais casser sur une couleur douteuse. */
function couleurSure(couleur: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(couleur.trim()) ? couleur.trim() : '#0284c7';
}

/** Les formes d'image qu'on accepte d'embarquer, et rien d'autre. */
const LOGO_EMBARQUE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * Le logo, ou rien du tout.
 *
 * Deux formes, et une seule est sans risque. Une adresse `http(s)` dépend du
 * réseau : si son hôte n'est pas dans le Walled Garden, le client voit un
 * cadre vide. Une image embarquée voyage dans la page et s'affiche toujours —
 * c'est celle que produit l'envoi depuis la console.
 *
 * Tout le reste est écarté : `javascript:` dans un `src` ne s'exécute pas,
 * mais rien ne justifie de laisser passer autre chose sur la page qu'on ne
 * peut justement pas se permettre de casser.
 */
function blocLogo(url: string | null): string {
  if (!url) return '';
  const propre = url.trim();
  const accepte = /^https?:\/\//i.test(propre) || LOGO_EMBARQUE.test(propre);
  if (!accepte) return '';
  return `<img class="logo" src="${echapper(propre)}" alt="" />`;
}

/**
 * Refuse un logo qu'on ne saurait pas servir, ou qui ferait exploser la page.
 *
 * Le plafond ne concerne que la forme embarquée : une adresse `http` ne pèse
 * que sa longueur. La console réduit l'image avant l'envoi ; ce contrôle est
 * là pour le cas où elle serait contournée, pas pour corriger son travail.
 */
export function exigerLogoUtilisable(url: string): void {
  const propre = url.trim();
  if (/^https?:\/\//i.test(propre)) return;

  if (!LOGO_EMBARQUE.test(propre)) {
    throw new BadRequestException(
      "Le logo doit être une adresse http(s) ou une image PNG, JPEG ou WebP envoyée depuis cet écran.",
    );
  }
  if (propre.length > LOGO_MAX_CARACTERES) {
    throw new BadRequestException(
      `L'image est trop lourde une fois embarquée dans la page (${Math.round(
        propre.length / 1024,
      )} Ko, maximum ${Math.round(LOGO_MAX_CARACTERES / 1024)} Ko). Le routeur refuse une page de plus de 61 440 octets.`,
    );
  }
}

/**
 * Le tableau des tarifs, tel que le client le lira.
 *
 * Les durées sont dites en heures, en jours ou en mois selon ce qui tombe
 * juste : « 720 h » ne veut rien dire au comptoir, « 1 mois » si.
 */
function blocTarifs(
  offres: { name: string; price: unknown; validityDurationSeconds: number; maxSharedUsers: number | null }[],
  devise: string,
  titre: string,
): string {
  if (offres.length === 0) return '';

  const lignes = offres
    .map((o) => {
      const prix = `${Number(o.price).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} ${devise}`;
      const appareils =
        o.maxSharedUsers && o.maxSharedUsers > 1 ? ` (${o.maxSharedUsers} appareils)` : '';
      return `        <tr><td class="prix">${echapper(prix)}</td><td class="duree">${echapper(
        duree(o.validityDurationSeconds) + appareils,
      )}</td></tr>`;
    })
    .join('\n');

  return `<div class="tarifs">
        <h2>${echapper(titre)}</h2>
        <table>
${lignes}
        </table>
      </div>`;
}

/** La durée dans l'unité qui tombe juste : 720 h ne se dit pas au comptoir. */
export function duree(secondes: number): string {
  if (secondes <= 0) return 'sans limite';
  const heures = secondes / 3600;
  if (heures < 1) return `${Math.round(secondes / 60)} min`;
  if (heures < 24) return `${arrondi(heures)} h`;
  const jours = heures / 24;
  if (jours < 7) return `${arrondi(jours)} jour${jours >= 2 ? 's' : ''}`;
  if (jours % 30 === 0) {
    const mois = jours / 30;
    return `${mois} mois`;
  }
  if (jours % 7 === 0) {
    const semaines = jours / 7;
    return `${semaines} semaine${semaines >= 2 ? 's' : ''}`;
  }
  return `${arrondi(jours)} jours`;
}

function arrondi(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

/**
 * Le pied de page : où l'on est, et comment on nous joint.
 *
 * Rien n'est cliquable, et ce n'est pas un oubli : un client captif n'a pas
 * Internet. Un lien Facebook ne mènerait nulle part, et un `tel:` ouvrirait
 * le composeur sur un téléphone, rien du tout sur un ordinateur portable.
 * Les lignes absentes ne laissent pas de trou.
 */
function blocPied(r: {
  piedDePage: string;
  adresse: string;
  telephones: string;
  reseauSocial: string;
}): string {
  return [r.piedDePage, r.adresse, r.telephones, r.reseauSocial]
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => echapper(l))
    .join('<br />');
}

/**
 * Ce que l'exploitant a saisi entre dans du HTML : il doit en sortir inerte.
 *
 * Un nom de réseau contenant `"` ou `<` casserait l'attribut ou la balise
 * qui le porte — et la page de connexion est précisément celle qu'on ne peut
 * pas se permettre de casser. Les accents, eux, deviennent des entités :
 * l'API du routeur refuse tout octet au-dessus de 127.
 */
function echapper(texte: string): string {
  return [...texte]
    .map((c) => {
      if (c === '&') return '&amp;';
      if (c === '<') return '&lt;';
      if (c === '>') return '&gt;';
      if (c === '"') return '&quot;';
      if (c === "'") return '&#39;';
      // `codePointAt`, et non `charCodeAt` : sur un emoji, le second rend la
      // moitie haute du couple de substitution — « 📶 » devenait `&#55357;`,
      // un demi-caractere invalide que le navigateur affiche en losange. La
      // page de ce parc en porte quatre, et c'est ce qui l'empechait de
      // passer par l'API du routeur, qui refuse tout octet au-dessus de 127.
      const point = c.codePointAt(0) ?? 0;
      return point > 127 ? `&#${point};` : c;
    })
    .join('');
}
