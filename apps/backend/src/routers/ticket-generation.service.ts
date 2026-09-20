import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditResult } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { generateVoucherCode } from '../vouchers/voucher-code.util.js';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';

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
    const profils =
      demande.cible === 'user-manager'
        ? (await mikrotik.getUserManagerProfiles()).map((p) => p.name)
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
      },
    });

    return resultat;
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
