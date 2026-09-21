import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
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
}

export interface EtatPageConnexion {
  reglages: ReglagesPageConnexion;
  /** `true` tant que l'exploitant n'a rien enregistré : tout vient des défauts. */
  parDefaut: boolean;
  cibles: CiblePublication[];
  /** Ce qui empêche de publier. Vide, la publication est possible. */
  empechements: string[];
  /** Ce qui mérite d'être lu avant de publier, sans l'empêcher. */
  avertissements: string[];
}

@Injectable()
export class PageConnexionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly clients: MikrotikClientFactory,
    private readonly audit: AuditService,
  ) {}

  private async modele(): Promise<string> {
    for (const chemin of CHEMINS_MODELE) {
      try {
        return await readFile(chemin, 'utf8');
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
      select: { slug: true },
    });
    if (!tenant) throw new NotFoundException('Exploitant introuvable');

    const { reglages } = await this.reglages();
    const r = { ...reglages, ...nettoyer(remplace) };

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
      .replaceAll('__LIEU__', echapper(r.piedDePage))
      .replaceAll('__COULEUR__', couleurSure(r.couleur))
      .replaceAll('__BLOC_LOGO__', blocLogo(r.logoUrl))
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
  async etat(routerId?: string, portailSaisi?: string): Promise<EtatPageConnexion> {
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

    const [serveurs, profils, fichiers, wgHotes, wgAdresses, publications] = await Promise.all([
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
      return {
        chemin,
        serveurs: e.serveurs,
        motDePasseEnClairAccepte: e.pap,
        publie: publie ? { octets: publie.octets, publieLe: publie.publieLe } : null,
        surLeRouteur: surLeRouteur
          ? { octets: surLeRouteur.sizeBytes, modifieLe: surLeRouteur.lastModified }
          : null,
      };
    });

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
      const noms = profils
        .map((p) => p.dnsName)
        .filter((n): n is string => Boolean(n))
        .map((n) => n.toLowerCase());
      const adresses = profils
        .map((p) => p.hotspotAddress)
        .filter((a): a is string => Boolean(a) && a !== '0.0.0.0');

      if (hote && (noms.includes(hote) || adresses.includes(hote))) {
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

    return { reglages, parDefaut, cibles, empechements, avertissements };
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
          create: { tenantId, routerId, chemin: cible.chemin, octets, publiePar: adminUserId },
          update: { octets, publieLe: new Date(), publiePar: adminUserId },
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

/**
 * Le logo, ou rien du tout.
 *
 * Seuls `http://` et `https://` sont acceptés : une adresse `javascript:`
 * dans un attribut `src` ne s'exécute pas, mais rien ne justifie de laisser
 * passer autre chose sur la page qu'on ne peut pas se permettre de casser.
 */
function blocLogo(url: string | null): string {
  if (!url) return '';
  if (!/^https?:\/\//i.test(url.trim())) return '';
  return `<img class="logo" src="${echapper(url.trim())}" alt="" />`;
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
      return c.charCodeAt(0) > 127 ? `&#${c.charCodeAt(0)};` : c;
    })
    .join('');
}
