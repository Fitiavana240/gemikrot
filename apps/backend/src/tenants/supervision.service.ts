import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { etatDe } from './abonnement-plateforme.service.js';

/**
 * SAS-4 : la plateforme vue d'en haut, pour celui qui l'exploite.
 *
 * Le SUPER_ADMIN avait la liste de ses exploitants, et rien d'autre. Pour
 * savoir si l'un d'eux était en panne, il fallait se mettre à sa place, un
 * par un — et donc savoir d'avance lequel regarder, ce qui est exactement
 * l'information qui manquait.
 *
 * **Traverse volontairement le cloisonnement.** C'est le seul service qui le
 * fasse : il n'est appelé que par une route réservée au SUPER_ADMIN, et il
 * n'existe que pour voir l'ensemble. Le client brut est donc employé à
 * dessein, et jamais `scoped`, qui ne rendrait rien hors du contexte d'un
 * exploitant.
 *
 * **Aucune lecture du routeur.** L'état d'un routeur vient de ce que la base
 * a retenu du dernier contact : interroger vingt routeurs pour afficher un
 * tableau les ferait tous attendre, et un lien lent suffirait à rendre la
 * page inutilisable. Ce qui s'affiche est donc « aux dernières nouvelles »,
 * et l'écran le dit.
 */

export interface LigneExploitant {
  id: string;
  nom: string;
  reseau: string;
  statut: string;
  /** Où en est son abonnement à la plateforme. */
  abonnement: string;
  joursRestants: number | null;
  routeurs: number;
  routeursJoignables: number;
  clients: number;
  /** Paiements vérifiés depuis trente jours, en monnaie de l'exploitant. */
  recette30j: string;
  devise: string;
  paiementsEnAttente: number;
  /** Dernier signe de vie d'un de ses routeurs, ou `null`. */
  dernierContact: Date | null;
}

export interface Supervision {
  exploitants: LigneExploitant[];
  totaux: {
    exploitants: number;
    actifs: number;
    routeurs: number;
    routeursJoignables: number;
    clients: number;
    paiementsEnAttente: number;
  };
  /** Ce qui demande une décision de la plateforme, dit en clair. */
  alertes: string[];
}

/** Au-delà, le routeur n'a plus donné signe de vie depuis trop longtemps. */
const MUET_DEPUIS_MINUTES = 30;

@Injectable()
export class SupervisionService {
  constructor(private readonly prisma: PrismaService) {}

  async apercu(): Promise<Supervision> {
    const ilYA30Jours = new Date(Date.now() - 30 * 86_400_000);
    const seuilMuet = new Date(Date.now() - MUET_DEPUIS_MINUTES * 60_000);

    const tenants = await this.prisma.tenant.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        wifiName: true,
        status: true,
        currency: true,
        platformEndsAt: true,
        platformGraceEndsAt: true,
        routers: { select: { id: true, lastSeenAt: true } },
        _count: { select: { customers: true } },
      },
    });

    // Deux agrégats par exploitant, en deux requêtes pour tous : une boucle de
    // requêtes ferait vingt allers-retours pour vingt exploitants.
    const [recettes, attentes] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['tenantId'],
        where: { status: PaymentStatus.VERIFIED, verifiedAt: { gte: ilYA30Jours } },
        _sum: { amount: true },
      }),
      this.prisma.payment.groupBy({
        by: ['tenantId'],
        where: { status: PaymentStatus.PENDING },
        _count: { _all: true },
      }),
    ]);
    const recetteDe = new Map(recettes.map((r) => [r.tenantId, r._sum.amount]));
    const attenteDe = new Map(attentes.map((a) => [a.tenantId, a._count._all]));

    const exploitants: LigneExploitant[] = tenants.map((t) => {
      const { etat, joursRestants } = etatDe(t.platformEndsAt, t.platformGraceEndsAt);
      /**
       * « Joignable » se déduit de la date, et d'elle seule.
       *
       * La colonne `status` était tentante, mais elle porte le vocabulaire de
       * la base — `online`, `unreachable` — et non celui du disjoncteur, qui
       * dit `JOIGNABLE` en mémoire. Les confondre comptait zéro routeur
       * joignable sur un parc qui répondait : relevé ici même, et c'est ce que
       * deux vocabulaires pour une seule idée finissent toujours par produire.
       *
       * La date suffit : un routeur dont on n'a rien su depuis une demi-heure
       * est muet, quoi qu'en dise une colonne figée.
       */
      const joignables = t.routers.filter(
        (r) => r.lastSeenAt && r.lastSeenAt > seuilMuet,
      ).length;
      const contacts = t.routers
        .map((r) => r.lastSeenAt)
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime());

      return {
        id: t.id,
        nom: t.name,
        reseau: t.wifiName,
        statut: t.status,
        abonnement: etat,
        joursRestants,
        routeurs: t.routers.length,
        routeursJoignables: joignables,
        clients: t._count.customers,
        recette30j: (recetteDe.get(t.id) ?? 0).toString(),
        devise: t.currency,
        paiementsEnAttente: attenteDe.get(t.id) ?? 0,
        dernierContact: contacts[0] ?? null,
      };
    });

    /**
     * Les alertes, dans l'ordre où elles coûtent.
     *
     * Un exploitant dont tous les routeurs sont muets ne vend plus rien ; un
     * abonnement échu est de l'argent que la plateforme n'encaisse pas ; un
     * exploitant sans routeur n'a jamais fini son installation. Les trois se
     * lisent d'un coup d'œil, ou ne se lisent jamais.
     */
    const alertes: string[] = [];
    const muets = exploitants.filter(
      (e) => e.statut === 'ACTIVE' && e.routeurs > 0 && e.routeursJoignables === 0,
    );
    if (muets.length > 0) {
      alertes.push(
        `${muets.length} exploitant(s) n'ont plus aucun routeur joignable : ${muets
          .map((e) => e.nom)
          .join(', ')}. Ils ne peuvent plus vendre depuis la console.`,
      );
    }
    const echus = exploitants.filter((e) => e.abonnement === 'expire');
    if (echus.length > 0) {
      alertes.push(
        `${echus.length} abonnement(s) plateforme expiré(s) : ${echus.map((e) => e.nom).join(', ')}.`,
      );
    }
    const jamaisInstalles = exploitants.filter(
      (e) => e.statut === 'ACTIVE' && e.routeurs === 0,
    );
    if (jamaisInstalles.length > 0) {
      alertes.push(
        `${jamaisInstalles.length} exploitant(s) actif(s) sans aucun routeur raccordé : ${jamaisInstalles
          .map((e) => e.nom)
          .join(', ')}. Leur mise en route n'est pas terminée.`,
      );
    }

    return {
      exploitants,
      totaux: {
        exploitants: exploitants.length,
        actifs: exploitants.filter((e) => e.statut === 'ACTIVE').length,
        routeurs: exploitants.reduce((n, e) => n + e.routeurs, 0),
        routeursJoignables: exploitants.reduce((n, e) => n + e.routeursJoignables, 0),
        clients: exploitants.reduce((n, e) => n + e.clients, 0),
        paiementsEnAttente: exploitants.reduce((n, e) => n + e.paiementsEnAttente, 0),
      },
      alertes,
    };
  }
}
