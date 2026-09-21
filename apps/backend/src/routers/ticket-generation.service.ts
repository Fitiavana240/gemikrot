import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditResult } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { generateVoucherCode } from '../vouchers/voucher-code.util.js';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { TicketTemplatesService } from '../tickets/ticket-templates.service.js';
import { PlancheRouteurService, type RapportPlanches } from '../tickets/planche-routeur.service.js';

export type CibleGeneration = 'user-manager' | 'hotspot';

/**
 * Au-delà, la génération prend trop longtemps pour une requête HTTP.
 *
 * User Manager crée en lot, mais l'attribution du profil se fait compte par
 * compte ; le HotSpot, lui, n'a pas de création groupée du tout. À 200, un
 * routeur lent tient déjà plusieurs minutes — et un délai dépassé laisserait
 * des comptes créés que l'appelant ne verrait jamais.
 */
const MAX_PAR_LOT = 200;

export interface GenerationDemande {
  cible: CibleGeneration;
  profileName: string;
  quantite: number;
  /** Préfixe lisible, pour reconnaître le lot sur le routeur. */
  prefixe?: string;
  longueurCode?: number;
  commentaire?: string;
}

export interface GenerationResultat {
  cible: CibleGeneration;
  profileName: string;
  /** Les codes réellement créés, dans l'ordre. */
  codes: string[];
  /** Ce qui a échoué, avec son motif — la génération ne s'arrête pas pour un. */
  echecs: { code: string; motif: string }[];
  /**
   * Plafond de temps cumulé posé sur chaque compte HotSpot créé, en secondes.
   *
   * `null` quand il n'y avait rien à en déduire — et c'est alors une
   * information, pas un détail : les tickets partent sans borne cumulée.
   */
  plafondCumule?: number | null;
  /**
   * Les planches A4 déposées sur le routeur, avec leur chemin **et leurs
   * octets**.
   *
   * La planche est rangée là où vit la base des comptes, sur la clé USB du
   * routeur : c'est elle qui fait foi. Mais elle est aussi rendue ici, et ce
   * n'est pas une commodité — c'est une nécessité mesurée. Le routeur ne rend
   * pas le contenu d'un fichier de plus de 4 096 octets, et il masque les
   * mots de passe : passé cette réponse, la planche n'est plus ni relisible
   * ni reconstructible. Ne pas la joindre obligerait à ouvrir WinBox pour
   * imprimer ce qu'on vient de créer.
   */
  planches?: { chemin: string; tickets: number; octets: number; pdfBase64: string }[];
  /** Planches qui n'ont pas pu être écrites, sans que les tickets en pâtissent. */
  planchesEnEchec?: { chemin: string; motif: string }[];
}

/**
 * Génération directe de tickets depuis un profil du routeur.
 *
 * **À distinguer des lots de l'écran Tickets.** Un lot est un objet
 * commercial : il naît d'une offre, porte un prix, et chaque ticket y est
 * suivi de la vente à l'expiration. Ce qui est généré ici ne l'est pas — ce
 * sont des comptes bruts sur le routeur, tels que produirait l'action
 * « Generate Voucher » de WinBox. Ils apparaîtront dans la console avec
 * l'origine « hors application ».
 *
 * Cela sert le cas que les lots ne couvrent pas : un profil qui existe sur le
 * routeur sans offre correspondante dans l'application. Pour de la vente
 * suivie, c'est l'écran Tickets qu'il faut, et l'interface le dit.
 */
@Injectable()
export class TicketGenerationService {
  private readonly logger = new Logger(TicketGenerationService.name);

  constructor(
    private readonly clients: MikrotikClientFactory,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly modèles: TicketTemplatesService,
    private readonly planches: PlancheRouteurService,
  ) {}

  async generer(
    routerId: string,
    demande: GenerationDemande,
    adminUserId?: string,
  ): Promise<GenerationResultat> {
    if (demande.quantite < 1 || demande.quantite > MAX_PAR_LOT) {
      throw new BadRequestException(
        `La quantité doit être comprise entre 1 et ${MAX_PAR_LOT}.`,
      );
    }

    const mikrotik = await this.clients.forRouter(routerId);

    // Vérifier le profil avant de créer quoi que ce soit : un nom mal
    // orthographié produirait sinon des dizaines de comptes sans forfait,
    // qu'il faudrait retrouver et supprimer un par un.
    const profilsHotspot =
      demande.cible === 'hotspot' ? await mikrotik.getHotspotProfiles() : [];
    const profilsUm =
      demande.cible === 'user-manager' ? await mikrotik.getUserManagerProfiles() : [];
    const profils =
      demande.cible === 'user-manager'
        ? profilsUm.map((p) => p.name)
        : profilsHotspot.map((p) => p.name);

    if (!profils.includes(demande.profileName)) {
      throw new BadRequestException(
        `Le profil « ${demande.profileName} » n'existe pas sur ce routeur.`,
      );
    }

    /**
     * Le plafond de temps **cumulé**, déduit du profil du routeur.
     *
     * Deux chemins créaient des tickets HotSpot, et un seul posait ce
     * plafond. Relevé sur le parc : **228 tickets « 2 heures » invendus
     * n'en avaient aucun**, tous générés par ici ; les 100 déjà vendus, passés
     * par l'autre chemin, le portaient. Sans lui, le `session-timeout` du
     * profil est le seul garde-fou — or il **repart à zéro à chaque
     * reconnexion**, et le `mac-cookie` rend cette reconnexion automatique.
     * Un ticket de deux heures pouvait donc servir deux heures par session,
     * sans fin.
     *
     * La durée est prise sur le profil plutôt qu'inventée : c'est ce que
     * l'exploitant a écrit lui-même en créant « 2Heure-500Ar ». Quand le
     * profil n'en porte pas, on ne devine pas — on le dit.
     */
    const plafondCumule =
      demande.cible === 'hotspot'
        ? (profilsHotspot.find((p) => p.name === demande.profileName)?.sessionTimeoutSeconds ??
          null)
        : null;

    const codes = this.tirerCodes(demande);
    const resultat =
      demande.cible === 'user-manager'
        ? await this.genererUserManager(mikrotik, codes, demande)
        : await this.genererHotspot(mikrotik, codes, demande, plafondCumule);

    /**
     * La validité à imprimer, prise sur le profil du routeur.
     *
     * Côté HotSpot c'est la durée de session ; côté User Manager, la validité
     * du profil — qui est calendaire. Les deux se lisent sur le routeur et non
     * dans l'application : c'est lui qui les appliquera au client.
     */
    const validité =
      demande.cible === 'hotspot'
        ? plafondCumule
        : (profilsUm.find((p) => p.name === demande.profileName)?.validityDurationSeconds ?? null);

    const planches = await this.déposerPlanches(mikrotik, routerId, resultat.codes, demande, validité);

    await this.audit.log({
      adminUserId,
      routerId,
      action: 'GENERATE_TICKETS',
      targetType: demande.cible === 'user-manager' ? 'UserManagerUser' : 'HotspotUser',
      targetId: demande.profileName,
      result: resultat.echecs.length ? AuditResult.FAILURE : AuditResult.SUCCESS,
      payloadDiff: {
        cible: demande.cible,
        profileName: demande.profileName,
        demandes: demande.quantite,
        crees: resultat.codes.length,
        echecs: resultat.echecs.length,
        planches: planches.planches.map((p) => p.chemin),
      },
    });

    return {
      ...resultat,
      planches: planches.planches,
      planchesEnEchec: planches.échecs,
    };
  }

  /**
   * Écrit les planches A4 sur le routeur, sans jamais faire échouer le lot.
   *
   * Les comptes sont déjà créés quand on arrive ici : une clé USB absente ou
   * un disque plein ne doit pas faire croire que la génération a raté. L'échec
   * est rendu à côté des codes, que l'exploitant garde de toute façon.
   */
  private async déposerPlanches(
    mikrotik: Awaited<ReturnType<MikrotikClientFactory['forRouter']>>,
    routerId: string,
    codes: string[],
    demande: GenerationDemande,
    validitéSecondes: number | null,
  ): Promise<RapportPlanches> {
    const vide: RapportPlanches = { planches: [], échecs: [], emplacement: '' };
    if (codes.length === 0) return vide;

    try {
      // L'exploitant se lit sur le ROUTEUR, pas dans le contexte de la
      // requête. `requireTenantId()` lève pour un SUPER_ADMIN, qui n'a pas
      // d'exploitant à lui : la planche n'était alors pas produite du tout,
      // en silence, alors que les comptes, eux, étaient bien créés. Constaté
      // sur une vraie génération, pas déduit.
      //
      // Ce n'est pas la faille de l'import corrigée par ailleurs : on ne se
      // donne pas ici l'accès à un routeur, il est déjà résolu et autorisé.
      // On demande seulement quel nom de réseau imprimer sur la feuille — et
      // la bonne réponse est celui de l'exploitant à qui le routeur appartient.
      const tenant = await this.prisma.tenant.findUniqueOrThrow({
        where: { id: await this.exploitantDuRouteur(routerId) },
        select: { wifiName: true, domains: true },
      });
      const modèles = await this.modèles.findAll();
      const parPage = modèles.find((m) => m.isDefault)?.perPage ?? modèles[0]?.perPage ?? 30;

      // L'horodatage dans le nom plutôt qu'un numéro : deux lots du même
      // profil le même jour ne doivent pas s'écraser l'un l'autre sur la clé.
      //
      // Il vient de l'horloge du ROUTEUR, et non de celle du serveur. Les
      // deux ne coïncident pas : le serveur datait en UTC, le routeur vit en
      // +03:00, et WinBox affiche ses fichiers à l'heure locale. Une planche
      // écrite à 3 h du matin s'appelait donc « 0001 » à côté d'une date de
      // modification à 03:01 — et, passé minuit, portait carrément la veille.
      const horodatage = await this.horodatageDuRouteur(mikrotik);
      const étiquette = `${demande.profileName}-${horodatage}`.replace(/[^A-Za-z0-9_.-]/g, '_');

      return await this.planches.écrire(mikrotik, {
        tickets: codes.map((code) => ({ code, offre: demande.profileName, prix: '' })),
        validitéSecondes,
        réseau: tenant.wifiName,
        domaines: tenant.domains,
        parPage,
        étiquette,
      });
    } catch (error) {
      this.logger.warn(`Planches non produites : ${String(error)}`);
      return { ...vide, échecs: [{ chemin: '', motif: error instanceof Error ? error.message : String(error) }] };
    }
  }

  /**
   * `202609210300`, à l'heure du routeur.
   *
   * Si l'horloge est illisible, on retombe sur celle du serveur plutôt que
   * de perdre la planche : un nom approximatif vaut mieux que pas de feuille.
   */
  private async horodatageDuRouteur(
    mikrotik: Awaited<ReturnType<MikrotikClientFactory['forRouter']>>,
  ): Promise<string> {
    try {
      const { date, time } = await mikrotik.getClock();
      const brut = `${date}${time.slice(0, 5)}`.replace(/[:\-]/g, '');
      if (/^\d{12}$/.test(brut)) return brut;
    } catch {
      // Horloge injoignable : la suite s'en passe.
    }
    return new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '');
  }

  /**
   * À quel exploitant appartient ce routeur.
   *
   * Le contexte de requête suffit pour un ADMIN, et ne dit rien pour un
   * SUPER_ADMIN. Le routeur, lui, porte toujours son `tenantId` : c'est la
   * source qui répond dans les deux cas.
   */
  private async exploitantDuRouteur(routerId: string): Promise<string> {
    const contexte = this.tenantContext.get()?.tenantId;
    if (contexte) return contexte;
    // Client non cloisonné à dessein : `forRouter` a déjà résolu ce routeur
    // par le client cloisonné, donc l'appelant y a droit. On ne fait que lire
    // à qui il appartient.
    const routeur = await this.prisma.router.findUniqueOrThrow({
      where: { id: routerId },
      select: { tenantId: true },
    });
    return routeur.tenantId;
  }

  /**
   * Des codes tous distincts, sans relire le routeur.
   *
   * Un `Set` suffit : l'alphabet de `generateVoucherCode` écarte déjà les
   * caractères qu'on confond à l'oral, et une collision avec un compte
   * existant fera échouer cette création-là sans emporter le reste du lot.
   */
  private tirerCodes(demande: GenerationDemande): string[] {
    const longueur = demande.longueurCode ?? 8;
    const vus = new Set<string>();
    while (vus.size < demande.quantite) {
      vus.add(generateVoucherCode(longueur, demande.prefixe));
    }
    return [...vus];
  }

  private async genererUserManager(
    mikrotik: Awaited<ReturnType<MikrotikClientFactory['forRouter']>>,
    codes: string[],
    demande: GenerationDemande,
  ): Promise<GenerationResultat> {
    const echecs: GenerationResultat['echecs'] = [];

    // La création est groupée — elle ne relit la liste des comptes qu'une
    // fois — mais l'attribution du profil ne l'est pas côté RouterOS.
    await mikrotik.createUserManagerUsers(
      codes.map((code) => ({
        username: code,
        password: code,
        ...(demande.commentaire ? { comment: demande.commentaire } : {}),
      })),
    );

    const attribues: string[] = [];
    for (const code of codes) {
      try {
        await mikrotik.assignProfile({ username: code, profileName: demande.profileName });
        attribues.push(code);
      } catch (error) {
        // Un compte sans forfait n'ouvre rien : le signaler nommément vaut
        // mieux que de le laisser passer pour un ticket valide.
        echecs.push({
          code,
          motif: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (echecs.length) {
      this.logger.warn(
        `Génération ${demande.profileName} : ${echecs.length} attribution(s) en échec sur ${codes.length}`,
      );
    }
    return { cible: 'user-manager', profileName: demande.profileName, codes: attribues, echecs };
  }

  private async genererHotspot(
    mikrotik: Awaited<ReturnType<MikrotikClientFactory['forRouter']>>,
    codes: string[],
    demande: GenerationDemande,
    plafondCumule: number | null,
  ): Promise<GenerationResultat> {
    const crees: string[] = [];
    const echecs: GenerationResultat['echecs'] = [];

    for (const code of codes) {
      try {
        await mikrotik.createHotspotUser({
          username: code,
          password: code,
          profileName: demande.profileName,
          ...(demande.commentaire ? { comment: demande.commentaire } : {}),
          // Le seul plafond qui borne réellement un ticket HotSpot.
          ...(plafondCumule !== null ? { limitUptimeSeconds: plafondCumule } : {}),
        });
        crees.push(code);
      } catch (error) {
        echecs.push({
          code,
          motif: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (echecs.length) {
      this.logger.warn(
        `Génération ${demande.profileName} : ${echecs.length} création(s) en échec sur ${codes.length}`,
      );
    }
    return { cible: 'hotspot', profileName: demande.profileName, codes: crees, echecs, plafondCumule };
  }
}
