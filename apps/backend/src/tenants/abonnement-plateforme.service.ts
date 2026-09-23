import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CourrielService } from '../courriel/courriel.service.js';
import {
  ESSAI_JOURS,
  JOUR_MS,
  OFFRES,
  TOLERANCE_JOURS,
  montantDu,
  offreParCode,
  offreParNom,
  prochaineEcheance,
  contactPlateforme,
  type CodeOffre,
  type ContactPlateforme,
  type OffrePlateforme,
} from './offres-plateforme.js';

/**
 * Ce que l'exploitant doit à la plateforme, et ce qui arrive s'il ne paie pas.
 *
 * Un exploitant était actif ou suspendu, et rien ne le faisait payer.
 *
 * **L'expiration ne coupe jamais les clients finaux, et c'est structurel.**
 * Le routeur applique seul les validités : une plateforme impayée n'a aucun
 * moyen — ni aucune raison — de priver d'Internet des gens qui ont payé leur
 * ticket. Elle ferme la console, pas le Wi-Fi. Un exploitant en retard garde
 * donc son réseau debout et ses clients servis ; ce qu'il perd, c'est de
 * pouvoir vendre de nouveaux accès depuis l'application.
 *
 * **Et la lecture reste ouverte.** Fermer aussi la consultation reviendrait à
 * prendre en otage les données de quelqu'un pour une facture : il doit
 * pouvoir voir ses clients, ses recettes et son journal, même en retard.
 * Seule l'écriture s'arrête.
 */

export type ÉtatAbonnement = 'sans-abonnement' | 'a-jour' | 'en-tolerance' | 'expire';

export interface AbonnementPlateforme {
  offre: string | null;
  /** Le code du catalogue, quand le nom enregistré s'y rattache. */
  offreCode: CodeOffre | null;
  maxRouteurs: number | null;
  routeursUtilises: number;
  echeance: string | null;
  finDeTolerance: string | null;
  etat: ÉtatAbonnement;
  /** Jours restants avant la fermeture de l'écriture. Négatif = dépassé. */
  joursRestants: number | null;
  /** Vrai quand l'écriture est refusée. La lecture, elle, ne l'est jamais. */
  ecritureBloquee: boolean;
  /**
   * Ce qu'un renouvellement coûterait, parc actuel compris. `null` quand
   * l'offre enregistrée ne se rattache à rien de connu — mieux vaut pas de
   * montant qu'un montant inventé.
   */
  montantDu: number | null;
  /** Prix unitaire de l'offre en cours, par routeur et par période. */
  prixParRouteur: number | null;
  /** « mois », « an », « 5 jours » : la période telle qu'elle se dit. */
  periode: string | null;
  devise: string;
}

export function etatDe(
  echeance: Date | null,
  finDeTolerance: Date | null,
  maintenant = new Date(),
): { etat: ÉtatAbonnement; joursRestants: number | null } {
  // Pas d'échéance, pas de blocage : c'est le cas de tout exploitant qui n'a
  // pas encore de contrat, et il ne doit surtout pas se retrouver bloqué par
  // un champ resté vide.
  if (!echeance) return { etat: 'sans-abonnement', joursRestants: null };

  const jours = Math.ceil((echeance.getTime() - maintenant.getTime()) / JOUR_MS);
  if (maintenant <= echeance) return { etat: 'a-jour', joursRestants: jours };

  const limite = finDeTolerance ?? new Date(echeance.getTime() + TOLERANCE_JOURS * JOUR_MS);
  if (maintenant <= limite) {
    return {
      etat: 'en-tolerance',
      joursRestants: Math.ceil((limite.getTime() - maintenant.getTime()) / JOUR_MS),
    };
  }
  return { etat: 'expire', joursRestants: jours };
}

@Injectable()
export class AbonnementPlateformeService {
  private readonly logger = new Logger(AbonnementPlateformeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    /**
     * Facultatif : un SMTP absent ne doit pas empecher d'enregistrer un
     * abonnement. On encaisse d'abord, on previent ensuite.
     */
    private readonly courriel?: CourrielService,
  ) {}

  /** Le catalogue et l'adresse ou payer, tels que la page de blocage les montre. */
  offres(): { offres: OffrePlateforme[]; contact: ContactPlateforme } {
    return { offres: OFFRES, contact: contactPlateforme() };
  }

  /** L'abonnement de l'exploitant sur lequel porte la requête courante. */
  etatDeLExploitantCourant(): Promise<AbonnementPlateforme> {
    return this.etat(this.tenantContext.requireTenantId());
  }

  /** L'état vu par l'exploitant lui-même. */
  async etat(tenantId: string): Promise<AbonnementPlateforme> {
    const [tenant, routeurs] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          platformPlanName: true,
          maxRouters: true,
          platformEndsAt: true,
          platformGraceEndsAt: true,
          currency: true,
        },
      }),
      this.prisma.router.count({ where: { tenantId } }),
    ]);

    const { etat, joursRestants } = etatDe(
      tenant?.platformEndsAt ?? null,
      tenant?.platformGraceEndsAt ?? null,
    );

    // Le nom enregistré a longtemps été du texte libre : il ne se rattache pas
    // toujours au catalogue, et on ne devine pas. Sans offre identifiée, pas
    // de montant — un chiffre inventé serait pire que pas de chiffre.
    const offre = offreParNom(tenant?.platformPlanName);

    return {
      offre: tenant?.platformPlanName ?? null,
      offreCode: offre?.code ?? null,
      maxRouteurs: tenant?.maxRouters ?? null,
      routeursUtilises: routeurs,
      echeance: tenant?.platformEndsAt?.toISOString() ?? null,
      finDeTolerance: tenant?.platformGraceEndsAt?.toISOString() ?? null,
      etat,
      joursRestants,
      ecritureBloquee: etat === 'expire',
      montantDu: offre ? montantDu(offre, routeurs) : null,
      prixParRouteur: offre?.prixParRouteur ?? null,
      periode: offre?.periode ?? null,
      devise: tenant?.currency ?? 'MGA',
    };
  }

  /**
   * Refuse une écriture quand l'abonnement est échu, tolérance comprise.
   *
   * Appelé là où l'on crée de la vente — pas partout. Bloquer une correction
   * de numéro de téléphone pour une facture impayée serait une punition sans
   * rapport avec la faute.
   */
  async exigerAbonnementValide(tenantId: string): Promise<void> {
    const { etat, finDeTolerance } = await this.etat(tenantId);
    if (etat !== 'expire') return;

    throw new ForbiddenException(
      `Votre abonnement à la plateforme a expiré${
        finDeTolerance ? ` le ${new Date(finDeTolerance).toLocaleDateString('fr-FR')}` : ''
      }. La vente est suspendue, mais vos clients gardent leur accès : le routeur continue de les servir. La consultation reste ouverte.`,
    );
  }

  /**
   * Refuse un routeur de plus que l'offre n'en autorise.
   *
   * Compté à la création, jamais après : retirer l'accès à un routeur déjà
   * raccordé parce que l'offre a changé couperait la main à quelqu'un qui
   * s'en sert.
   */
  async exigerRouteurDisponible(tenantId: string): Promise<void> {
    const { maxRouteurs, routeursUtilises } = await this.etat(tenantId);
    if (maxRouteurs == null || routeursUtilises < maxRouteurs) return;

    throw new ForbiddenException(
      `Votre offre autorise ${maxRouteurs} routeur(s), et vous en avez ${routeursUtilises}. Changez d'offre pour en raccorder un de plus.`,
    );
  }

  /**
   * Ouvre l'essai gratuit, une fois et une seule.
   *
   * **Il part à l'activation, pas à l'inscription.** Un compte inscrit le
   * lundi et activé le jeudi aurait brûlé trois jours des cinq sans avoir pu
   * se connecter une seule fois — la connexion est refusée tant que
   * l'exploitant n'est pas ACTIF.
   *
   * Rend `false` si une échéance existe déjà : réactiver un compte suspendu
   * ne rouvre pas un essai, sinon il suffirait de se faire suspendre pour en
   * obtenir un second.
   */
  async demarrerEssai(tenantId: string, adminUserId?: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { platformEndsAt: true },
    });
    if (!tenant || tenant.platformEndsAt) return false;

    const essai = offreParCode('ESSAI');
    if (!essai) return false;
    const fin = new Date(Date.now() + ESSAI_JOURS * JOUR_MS);

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        platformPlanName: essai.nom,
        maxRouters: essai.maxRouteurs,
        platformEndsAt: fin,
        // Pas de tolérance sur un essai : cinq jours plus quatorze feraient
        // dix-neuf jours gratuits. La tolérance couvre un virement qui
        // traîne, et un essai ne doit rien.
        platformGraceEndsAt: fin,
      },
    });

    await this.audit.log({
      adminUserId,
      tenantId,
      action: 'START_PLATFORM_TRIAL',
      targetType: 'Tenant',
      targetId: tenantId,
      payloadDiff: { offre: essai.nom, jours: ESSAI_JOURS, echeance: fin.toISOString() },
    });
    return true;
  }

  /**
   * Souscrit ou renouvelle une offre du catalogue, période calculée.
   *
   * Le SUPER_ADMIN posait l'échéance à la main : un renouvellement demandait
   * d'ajouter trente jours de tête, donc de se tromper un jour. Ici il choisit
   * l'offre, et la date se déduit.
   */
  async souscrire(
    tenantId: string,
    code: string,
    adminUserId: string,
  ): Promise<AbonnementPlateforme> {
    const offre = offreParCode(code);
    if (!offre) {
      throw new BadRequestException(
        `Offre inconnue : ${code}. Choisissez parmi ${OFFRES.map((o) => o.code).join(', ')}.`,
      );
    }
    if (offre.code === 'ESSAI') {
      throw new BadRequestException(
        "L'essai gratuit s'ouvre seul à l'activation du compte, et ne se renouvelle pas.",
      );
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { platformEndsAt: true, maxRouters: true },
    });
    const echeance = prochaineEcheance(tenant?.platformEndsAt ?? null, offre);

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        platformPlanName: offre.nom,
        // Le plafond de l'essai ne doit pas survivre à une vraie souscription,
        // sinon l'exploitant qui paie reste coincé à un routeur.
        maxRouters: offre.maxRouteurs,
        platformEndsAt: echeance,
        platformGraceEndsAt: new Date(echeance.getTime() + offre.toleranceJours * JOUR_MS),
        // `status` n'est volontairement pas touché : payer ne lève pas une
        // suspension, qui est une décision distincte.
      },
    });

    await this.audit.log({
      adminUserId,
      tenantId,
      action: 'SUBSCRIBE_PLATFORM',
      targetType: 'Tenant',
      targetId: tenantId,
      payloadDiff: { offre: offre.nom, code: offre.code, echeance: echeance.toISOString() },
    });

    await this.confirmerParCourriel(tenantId, offre.nom, echeance);
    return this.etat(tenantId);
  }

  /**
   * Confirme l'abonnement a ceux qui peuvent en repondre.
   *
   * C'est la raison d'etre de la confirmation d'adresse : sans boite joignable,
   * l'exploitant paie et ne recoit rien — ni recu, ni echeance, ni rappel
   * avant la fermeture. **Les adresses non confirmees sont ecartees**, pas par
   * severite mais par honnetete : ecrire a une adresse dont on sait qu'elle
   * n'a jamais repondu, c'est se donner l'illusion d'avoir prevenu.
   *
   * Depuis le serveur de la plateforme : c'est elle qui facture, pas
   * l'exploitant, et il n'a pas forcement regle son propre SMTP.
   */
  private async confirmerParCourriel(
    tenantId: string,
    offre: string,
    echeance: Date,
  ): Promise<void> {
    if (!this.courriel) return;
    try {
      const destinataires = await this.prisma.adminUser.findMany({
        where: { tenantId, role: 'ADMIN', emailVerifiedAt: { not: null } },
        select: { email: true },
      });
      const texte = [
        `Votre abonnement à GeMikrot est enregistré.`,
        '',
        `Offre : ${offre}`,
        `Valable jusqu'au ${echeance.toLocaleDateString('fr-FR')}`,
        '',
        "Passé cette date, une tolérance court avant que la vente ne se ferme.",
        'Vos clients, eux, gardent leur accès : le routeur applique seul les',
        'validités et continue de les servir.',
        '',
        '— GeMikrot',
      ].join('\n');

      for (const d of destinataires) {
        await this.courriel.envoyerDeLaPlateforme({
          destinataire: d.email,
          sujet: `Abonnement enregistré — ${offre}`,
          texte,
          type: 'abonnement-confirme',
        });
      }
    } catch (e) {
      // Trace et oublie : confirmer est un accessoire, encaisser ne l'est pas.
      this.logger.warn(
        `Confirmation d'abonnement non partie : ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /** Réservé au SUPER_ADMIN : pose l'offre, le plafond et l'échéance. */
  async definir(
    tenantId: string,
    dto: {
      platformPlanName?: string | null;
      maxRouters?: number | null;
      platformEndsAt?: string | null;
    },
    adminUserId: string,
  ) {
    const echeance = dto.platformEndsAt ? new Date(dto.platformEndsAt) : null;
    // La tolérance suit l'offre quand on la reconnaît : un essai n'en a pas.
    const tolerance = offreParNom(dto.platformPlanName)?.toleranceJours ?? TOLERANCE_JOURS;

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        platformPlanName: dto.platformPlanName ?? null,
        maxRouters: dto.maxRouters ?? null,
        platformEndsAt: echeance,
        // La tolérance se déduit de l'échéance : la laisser saisir à part
        // ouvrirait la porte à une tolérance antérieure à l'échéance, qui ne
        // veut rien dire.
        platformGraceEndsAt: echeance
          ? new Date(echeance.getTime() + tolerance * JOUR_MS)
          : null,
        // `status` n'est volontairement pas touché : une échéance posée sur
        // un compte suspendu ne le réveille pas. La suspension est une
        // décision distincte, et l'écraser ici la ferait disparaître sans
        // que personne ne l'ait voulu.
      },
    });

    await this.audit.log({
      adminUserId,
      tenantId,
      action: 'SET_PLATFORM_SUBSCRIPTION',
      targetType: 'Tenant',
      targetId: tenantId,
      payloadDiff: {
        offre: dto.platformPlanName ?? null,
        maxRouteurs: dto.maxRouters ?? null,
        echeance: echeance?.toISOString() ?? null,
      },
    });

    return this.etat(tenant.id);
  }
}
