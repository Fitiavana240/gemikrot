import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { etatDe } from '../tenants/abonnement-plateforme.service.js';

/**
 * Ce qui demande une décision, rassemblé en un endroit.
 *
 * L'information existait déjà — sur le tableau de bord, dans Paiements, dans
 * Abonnements — mais il fallait ouvrir le bon écran pour la trouver. Un
 * exploitant qui passe sa journée sur l'écran Tickets ne voit pas qu'un
 * client a payé il y a trois jours et attend toujours son code.
 *
 * **Rien n'est stocké.** Les notifications sont recalculées à chaque lecture,
 * à partir de l'état réel. Une table demanderait une tâche de fond pour
 * l'entretenir — il n'y en a pas — et surtout elle vieillirait : on lirait
 * « paiement en attente » sur un paiement validé la veille. Ce qui s'affiche
 * ici est vrai à la seconde où on le lit, ou n'existe pas.
 *
 * **Aucune lecture du routeur.** Une cloche se consulte souvent, et certaines
 * pages de diagnostic coûtent cinq appels : les y mettre ferait sonner le
 * matériel à chaque ouverture d'un menu. Ce qui dépend du routeur reste sur
 * le tableau de bord, où il est déjà, et où on l'a demandé.
 */

export type Gravite = 'urgent' | 'attention' | 'info';

export interface Notification {
  /** Stable d'une lecture à l'autre : c'est elle qu'on marque comme lue. */
  cle: string;
  gravite: Gravite;
  titre: string;
  detail: string;
  /** Où aller pour agir. Une notification sans issue est un reproche. */
  lien: string;
  lue: boolean;
}

/** Au-delà, un client qui a payé attend depuis trop longtemps. */
const ATTENTE_URGENTE_JOURS = 2;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
  ) {}

  async lister(adminUserId: string): Promise<Notification[]> {
    const tenantId = this.tenantContext.get()?.tenantId;
    // Le SUPER_ADMIN qui ne cible personne n'a pas d'exploitant à surveiller :
    // lui rendre une liste vide vaut mieux que de faire échouer sa barre.
    if (!tenantId) return [];

    const dansSeptJours = new Date(Date.now() + 7 * 86_400_000);
    const sansNumero = { phone: { startsWith: 'import:' } };

    const [
      enAttente,
      plusAncien,
      echeances,
      echeancesInjoignables,
      puces,
      prixARevoir,
      ticketsDisponibles,
      exploitant,
      lues,
    ] = await Promise.all([
      this.prisma.scoped.payment.count({ where: { status: PaymentStatus.PENDING } }),
      this.prisma.scoped.payment.findFirst({
        where: { status: PaymentStatus.PENDING },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.scoped.subscription.count({
        where: {
          status: { in: ['ACTIVE', 'GRACE'] },
          currentPeriodEnd: { lte: dansSeptJours },
        },
      }),
      this.prisma.scoped.subscription.count({
        where: {
          status: { in: ['ACTIVE', 'GRACE'] },
          currentPeriodEnd: { lte: dansSeptJours },
          customer: sansNumero,
        },
      }),
      this.prisma.scoped.mobileMoneyAccount.count({ where: { isActive: true } }),
      this.prisma.scoped.plan.count({ where: { status: 'ACTIVE', priceNeedsReview: true } }),
      this.prisma.scoped.voucher.count({ where: { status: 'CREATED' } }),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { platformEndsAt: true, platformGraceEndsAt: true },
      }),
      this.prisma.notificationLue.findMany({
        where: { adminUserId },
        select: { cle: true },
      }),
    ]);

    const liste: Omit<Notification, 'lue'>[] = [];

    if (enAttente > 0) {
      const jours = plusAncien
        ? Math.floor((Date.now() - plusAncien.createdAt.getTime()) / 86_400_000)
        : 0;
      liste.push({
        // Le nombre entre dans la clef : deux paiements de plus, c'est une
        // nouvelle chose à voir, pas la même déjà écartée.
        cle: `paiements-en-attente:${enAttente}`,
        gravite: jours >= ATTENTE_URGENTE_JOURS ? 'urgent' : 'attention',
        titre: `${enAttente} paiement(s) à vérifier`,
        detail:
          jours >= 1
            ? `Le plus ancien attend depuis ${jours} jour(s). Ce client a payé et n'a rien reçu.`
            : "Un client qui a payé n'a pas encore son accès.",
        lien: '/payments',
      });
    }

    if (puces === 0) {
      liste.push({
        cle: 'aucune-puce',
        gravite: 'urgent',
        titre: 'Aucune puce Mobile Money',
        detail:
          "Votre page de paiement montre les prix, puis un écran qui n'a aucun numéro à donner. Rien ne peut être encaissé en ligne.",
        lien: '/settings',
      });
    }

    if (echeances > 0) {
      liste.push({
        cle: `echeances-proches:${echeances}`,
        gravite: 'attention',
        titre: `${echeances} abonnement(s) à échéance sous 7 jours`,
        detail:
          echeancesInjoignables > 0
            ? `Dont ${echeancesInjoignables} sans numéro utilisable : ceux-là, vous ne pouvez prévenir de rien.`
            : 'À relancer avant la coupure.',
        lien: '/subscriptions',
      });
    }

    if (ticketsDisponibles === 0) {
      liste.push({
        cle: 'plus-de-tickets',
        gravite: 'attention',
        titre: 'Aucun ticket disponible dans l’application',
        detail:
          "Une vente au comptoir n'aura rien à donner. Le stock du routeur, lui, peut être plein : l'écran Tickets le dit.",
        lien: '/vouchers',
      });
    }

    if (prixARevoir > 0) {
      liste.push({
        cle: `prix-a-revoir:${prixARevoir}`,
        gravite: 'attention',
        titre: `${prixARevoir} offre(s) au prix non confirmé`,
        detail:
          "Le prix a été deviné à l'import. Tant qu'il n'est pas relu, l'offre ne peut pas passer au tarif public.",
        lien: '/plans',
      });
    }

    const { etat, joursRestants } = etatDe(
      exploitant?.platformEndsAt ?? null,
      exploitant?.platformGraceEndsAt ?? null,
    );
    if (etat === 'expire' || etat === 'en-tolerance') {
      liste.push({
        cle: `abonnement-plateforme:${etat}`,
        gravite: etat === 'expire' ? 'urgent' : 'attention',
        titre:
          etat === 'expire'
            ? 'Votre abonnement à la plateforme a expiré'
            : `Abonnement échu — ${joursRestants} jour(s) avant la fermeture des ventes`,
        // Ce qui n'arrive pas compte autant : sans cette phrase, on croit son
        // réseau coupé et on appelle ses clients pour rien.
        detail:
          'Vos clients gardent leur accès : le routeur applique seul les validités. Seules les ventes nouvelles s’arrêtent.',
        lien: '/settings',
      });
    }

    if (this.config.get<string>('SCHEDULER_ENABLED') !== 'true') {
      liste.push({
        cle: 'ordonnanceur-eteint',
        gravite: 'info',
        titre: 'Rien n’expire tout seul sur ce serveur',
        detail:
          "Les travaux de fond sont désactivés : chaque échéance demande un geste. L'onglet « Vérifier sur le routeur » des Tickets fait le travail à la main.",
        lien: '/vouchers',
      });
    }

    const dejaVues = new Set(lues.map((l) => l.cle));
    return liste.map((n) => ({ ...n, lue: dejaVues.has(n.cle) }));
  }

  /**
   * « J'ai vu. »
   *
   * Enregistré en base et non dans le navigateur : l'exploitant ouvre sa
   * console depuis le comptoir et depuis son téléphone, et revoir dix fois ce
   * qu'on a déjà écarté apprend à ne plus regarder la cloche.
   *
   * La clef porte le compte — « 3 paiements » et « 5 paiements » ne sont pas
   * la même nouvelle — donc écarter n'enterre pas ce qui s'aggrave.
   */
  async marquerLue(adminUserId: string, cle: string): Promise<void> {
    await this.prisma.notificationLue.upsert({
      where: { adminUserId_cle: { adminUserId, cle } },
      create: { adminUserId, cle },
      update: {},
    });
  }
}
