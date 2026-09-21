import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';

function startOfDay(from = new Date()): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate());
}
function startOfWeek(from = new Date()): Date {
  const day = from.getDay();
  const diff = (day + 6) % 7; // semaine ISO, lundi = premier jour
  const monday = new Date(from.getFullYear(), from.getMonth(), from.getDate() - diff);
  return monday;
}
function startOfMonth(from = new Date()): Date {
  return new Date(from.getFullYear(), from.getMonth(), 1);
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: MikrotikClientFactory,
    private readonly config: ConfigService,
  ) {}

  async getSummary() {
    const [
      vouchersByStatus,
      revenueToday,
      revenueThisWeek,
      revenueThisMonth,
      recentPayments,
      recentCustomers,
      hotspotActiveUsers,
    ] = await Promise.all([
      this.prisma.scoped.voucher.groupBy({ by: ['status'], _count: { _all: true } }),
      this.sumVerifiedSince(startOfDay()),
      this.sumVerifiedSince(startOfWeek()),
      this.sumVerifiedSince(startOfMonth()),
      this.prisma.scoped.payment.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.scoped.customer.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      // Le routeur peut être injoignable : le dashboard reste consultable.
      this.clients
        .forDefaultRouter()
        .then((mikrotik) => mikrotik.getHotspotActiveUsers())
        .catch(() => []),
    ]);

    // Ce qu'un exploitant regarde en ouvrant la console le matin : combien il
    // lui reste a vendre, qui arrive a echeance, et ce qui attend une
    // validation. Trois questions, trois comptages — et non trois ecrans.
    const dansSeptJours = new Date(Date.now() + 7 * 86_400_000);
    /**
     * Les fiches qu'on ne peut joindre.
     *
     * Le routeur ne stocke aucun telephone : l'import en ecrit un provisoire
     * de la forme `import:<compte>`, faute de mieux. Le champ etant obligatoire
     * et unique par exploitant, c'est la seule forme que prend l'absence de
     * numero -- il n'y a pas de case vide a chercher a cote.
     */
    const sansNumero: Prisma.CustomerWhereInput = { phone: { startsWith: 'import:' } };

    const [
      ticketsDisponibles,
      abonnesActifs,
      echeancesProches,
      echeancesProchesInjoignables,
      paiementsEnAttente,
      plusAncienEnAttente,
      clients,
      clientsInjoignables,
    ] =
      await Promise.all([
        this.prisma.scoped.voucher.count({ where: { status: 'CREATED' } }),
        this.prisma.scoped.subscription.count({ where: { status: { in: ['ACTIVE', 'GRACE'] } } }),
        this.prisma.scoped.subscription.count({
          where: {
            status: { in: ['ACTIVE', 'GRACE'] },
            currentPeriodEnd: { lte: dansSeptJours },
          },
        }),
        /**
         * Parmi ces echeances, celles qu'on ne peut prevenir de rien.
         *
         * << A relancer >> supposait qu'on sache ou joindre les gens. Le
         * routeur ne stocke aucun numero : une fiche importee en porte un
         * provisoire, qui ressemble a un vrai. Compte des maintenant, parce
         * que c'est ce qui decidera de l'utilite de l'avertissement par SMS
         * le jour ou la passerelle existera.
         */
        this.prisma.scoped.subscription.count({
          where: {
            status: { in: ['ACTIVE', 'GRACE'] },
            currentPeriodEnd: { lte: dansSeptJours },
            customer: sansNumero,
          },
        }),
        this.prisma.scoped.payment.count({ where: { status: PaymentStatus.PENDING } }),
        // Le plus ancien paiement encore en attente. Le compte seul ne dit
        // pas si la file avance : deux paiements déclarés ce matin et deux
        // qui traînent depuis trois jours donnent le même « 2 », alors que
        // le second cas est un client qui a payé et n'a rien reçu.
        this.prisma.scoped.payment.findFirst({
          where: { status: PaymentStatus.PENDING },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        // Les clients : le tableau de bord en montrait les dix derniers sans
        // jamais dire combien il y en a. Une liste de dix noms se lit pareil
        // qu'on en ait douze ou six cents.
        this.prisma.scoped.customer.count(),
        this.prisma.scoped.customer.count({ where: sansNumero }),
      ]);

    return {
      vouchersByStatus,
      revenue: { today: revenueToday, thisWeek: revenueThisWeek, thisMonth: revenueThisMonth },
      recentPayments,
      recentCustomers,
      connectedClients: hotspotActiveUsers.length,
      clients,
      clientsInjoignables,
      echeancesProchesInjoignables,
      ticketsDisponibles,
      abonnesActifs,
      echeancesProches,
      /**
       * Vrai quand les travaux de fond tournent.
       *
       * Même lecture que `SchedulerService`, et volontairement la même
       * expression : tout ce qui n'est pas exactement « true » laisse
       * l'ordonnanceur éteint. Sur cette installation la variable est
       * absente du `.env`, donc rien n'expire tout seul — et aucun écran ne
       * le disait, alors que tous parlent d'échéances.
       */
      ordonnanceurActif: this.config.get<string>('SCHEDULER_ENABLED') === 'true',
      paiementsEnAttente,
      /** `null` quand rien n'attend. */
      paiementEnAttenteDepuis: plusAncienEnAttente?.createdAt ?? null,
    };
  }

  private async sumVerifiedSince(since: Date): Promise<string> {
    const result = await this.prisma.scoped.payment.aggregate({
      where: { status: PaymentStatus.VERIFIED, verifiedAt: { gte: since } },
      _sum: { amount: true },
    });
    return (result._sum.amount ?? 0).toString();
  }
}
