import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminRole, PaymentStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { etatDe } from '../tenants/abonnement-plateforme.service.js';
import { offreParCode } from '../tenants/offres-plateforme.js';

/** L'offre d'essai du catalogue, resolue une fois. */
const ESSAI = offreParCode('ESSAI')!;

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

  async lister(adminUserId: string, role?: AdminRole): Promise<Notification[]> {
    const tenantId = this.tenantContext.get()?.tenantId;
    if (!tenantId) {
      /**
       * Le SUPER_ADMIN n'a pas d'exploitant, il a la plateforme.
       *
       * On lui rendait une liste vide. Sa cloche ne sonnait donc **jamais** —
       * et une inscription est restée une journée entière sans que personne
       * ne le sache, faute d'avoir pensé à ouvrir l'écran des exploitants.
       * Une cloche qui ne sonne jamais n'est pas une cloche silencieuse,
       * c'est une cloche cassée : on cesse de la regarder.
       */
      if (role === AdminRole.SUPER_ADMIN) return this.listerPourLaPlateforme(adminUserId);
      return [];
    }

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
   * Ce qui demande une décision **à la plateforme**, et non à un exploitant.
   *
   * Trois choses, dans l'ordre où elles coûtent. Une inscription non vue est
   * un client qui s'est présenté et qu'on a laissé sur le pas de la porte.
   * Un essai qui se termine est le seul moment où l'on peut encore le
   * convertir. Un abonnement échu est de l'argent qui ne rentre pas.
   *
   * **Aucune lecture du routeur**, ici comme ailleurs : une cloche se
   * consulte souvent, et interroger vingt routeurs la rendrait insupportable.
   */
  private async listerPourLaPlateforme(adminUserId: string): Promise<Notification[]> {
    const dansTroisJours = new Date(Date.now() + 3 * 86_400_000);
    const maintenant = new Date();

    const ilYA48h = new Date(Date.now() - 2 * 86_400_000);

    const [
      enAttente,
      inscriptionsRecentes,
      adressesNonConfirmees,
      smtpPlateforme,
      essaisQuiFinissent,
      expires,
      sansRouteur,
      lues,
    ] = await Promise.all([
      // Les comptes d'avant l'ouverture automatique : ils attendent encore.
      this.prisma.tenant.findMany({
        where: { status: TenantStatus.PENDING },
        orderBy: { createdAt: 'asc' },
        select: { name: true, createdAt: true },
      }),
      // Qui vient d'arriver. Le compte s'ouvre seul desormais : sans cette
      // ligne, une inscription ne laisse aucune trace visible, et le
      // SUPER_ADMIN apprend l'existence de ses clients par hasard.
      this.prisma.tenant.findMany({
        where: { createdAt: { gte: ilYA48h } },
        orderBy: { createdAt: 'desc' },
        select: { name: true, createdAt: true },
      }),
      // Une adresse jamais confirmee est un exploitant qu'on ne peut pas
      // prevenir : ni echeance, ni recu, ni rappel avant la fermeture.
      this.prisma.adminUser.count({
        where: { role: 'ADMIN', emailVerifiedAt: null },
      }),
      this.prisma.plateforme.findUnique({
        where: { id: 'plateforme' },
        select: { smtpActif: true, smtpHost: true },
      }),
      this.prisma.tenant.count({
        where: {
          status: TenantStatus.ACTIVE,
          platformPlanName: ESSAI.nom,
          platformEndsAt: { gte: maintenant, lte: dansTroisJours },
        },
      }),
      this.prisma.tenant.count({
        where: {
          status: TenantStatus.ACTIVE,
          platformGraceEndsAt: { lt: maintenant },
        },
      }),
      this.prisma.tenant.count({
        where: { status: TenantStatus.ACTIVE, routers: { none: {} } },
      }),
      this.prisma.notificationLue.findMany({
        where: { adminUserId },
        select: { cle: true },
      }),
    ]);

    const liste: Omit<Notification, 'lue'>[] = [];

    if (enAttente.length > 0) {
      const jours = Math.floor(
        (Date.now() - enAttente[0].createdAt.getTime()) / 86_400_000,
      );
      liste.push({
        cle: `exploitants-en-attente:${enAttente.length}`,
        gravite: jours >= 1 ? 'urgent' : 'attention',
        titre: `${enAttente.length} exploitant(s) en attente d'activation`,
        detail:
          jours >= 1
            ? `${enAttente[0].name} attend depuis ${jours} jour(s) et ne peut pas se connecter.`
            : `${enAttente[0].name} vient de s'inscrire et ne peut pas encore se connecter.`,
        lien: '/tenants',
      });
    }

    // **Avant tout le reste** : sans serveur d'envoi, aucun code de
    // confirmation ni avis d'inscription ne part, et rien d'autre dans cette
    // liste ne le dirait. C'est la panne qui rend toutes les autres muettes.
    if (!smtpPlateforme?.smtpActif || !smtpPlateforme.smtpHost) {
      liste.push({
        cle: 'smtp-plateforme-eteint',
        gravite: 'urgent',
        titre: 'La plateforme ne peut envoyer aucun courriel',
        detail:
          "Ni code de confirmation, ni avis d'inscription, ni confirmation d'abonnement. Les nouveaux inscrits ne peuvent pas valider leur adresse.",
        lien: '/settings/plateforme',
      });
    }

    if (inscriptionsRecentes.length > 0) {
      liste.push({
        cle: `inscriptions-recentes:${inscriptionsRecentes.length}`,
        gravite: 'info',
        titre: `${inscriptionsRecentes.length} nouvel(le)s inscription(s) en 48 h`,
        detail: `La plus récente : ${inscriptionsRecentes[0].name}. Leur essai gratuit court déjà.`,
        lien: '/tenants',
      });
    }

    if (adressesNonConfirmees > 0) {
      liste.push({
        cle: `adresses-non-confirmees:${adressesNonConfirmees}`,
        gravite: 'attention',
        titre: `${adressesNonConfirmees} adresse(s) jamais confirmée(s)`,
        detail:
          "Ces exploitants ne peuvent être prévenus de rien : ni échéance, ni reçu, ni rappel avant la fermeture de leurs ventes.",
        lien: '/tenants',
      });
    }

    if (essaisQuiFinissent > 0) {
      liste.push({
        cle: `essais-qui-finissent:${essaisQuiFinissent}`,
        gravite: 'attention',
        titre: `${essaisQuiFinissent} essai(s) gratuit(s) se terminent sous 3 jours`,
        detail:
          "C'est le seul moment où l'on peut encore proposer une offre. Après, la vente se ferme de leur côté.",
        lien: '/tenants',
      });
    }

    if (expires > 0) {
      liste.push({
        cle: `abonnements-expires:${expires}`,
        gravite: 'urgent',
        titre: `${expires} abonnement(s) expiré(s), tolérance comprise`,
        detail:
          'Ces exploitants ne peuvent plus vendre. Leurs clients, eux, gardent leur accès : le routeur applique seul les validités.',
        lien: '/supervision',
      });
    }

    if (sansRouteur > 0) {
      liste.push({
        cle: `exploitants-sans-routeur:${sansRouteur}`,
        gravite: 'info',
        titre: `${sansRouteur} exploitant(s) actif(s) sans aucun routeur`,
        detail: "Leur mise en route n'est pas terminée : ils n'ont encore rien pu vendre.",
        lien: '/supervision',
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
