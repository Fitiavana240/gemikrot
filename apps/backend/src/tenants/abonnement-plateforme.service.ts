import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { AuditService } from '../audit/audit.service.js';

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
  maxRouteurs: number | null;
  routeursUtilises: number;
  echeance: string | null;
  finDeTolerance: string | null;
  etat: ÉtatAbonnement;
  /** Jours restants avant la fermeture de l'écriture. Négatif = dépassé. */
  joursRestants: number | null;
  /** Vrai quand l'écriture est refusée. La lecture, elle, ne l'est jamais. */
  ecritureBloquee: boolean;
}

/** Deux semaines : le temps d'un virement qui traîne, pas d'un mois gratuit. */
const TOLERANCE_JOURS = 14;

/** Millisecondes d'une journée, pour un compte de jours lisible. */
const JOUR_MS = 86_400_000;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

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
        },
      }),
      this.prisma.router.count({ where: { tenantId } }),
    ]);

    const { etat, joursRestants } = etatDe(
      tenant?.platformEndsAt ?? null,
      tenant?.platformGraceEndsAt ?? null,
    );

    return {
      offre: tenant?.platformPlanName ?? null,
      maxRouteurs: tenant?.maxRouters ?? null,
      routeursUtilises: routeurs,
      echeance: tenant?.platformEndsAt?.toISOString() ?? null,
      finDeTolerance: tenant?.platformGraceEndsAt?.toISOString() ?? null,
      etat,
      joursRestants,
      ecritureBloquee: etat === 'expire',
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
          ? new Date(echeance.getTime() + TOLERANCE_JOURS * JOUR_MS)
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
