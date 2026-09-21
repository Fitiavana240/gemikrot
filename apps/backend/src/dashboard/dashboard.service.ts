import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
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
  ) {}

  async getSummary() {
    const [
      vouchersByStatus,
      revenueToday,
      revenueThisWeek,
      revenueThisMonth,
      revenueByPlan,
      revenueByMethod,
      recentPayments,
      recentCustomers,
      hotspotActiveUsers,
    ] = await Promise.all([
      this.prisma.scoped.voucher.groupBy({ by: ['status'], _count: { _all: true } }),
      this.sumVerifiedSince(startOfDay()),
      this.sumVerifiedSince(startOfWeek()),
      this.sumVerifiedSince(startOfMonth()),
      this.prisma.scoped.payment.groupBy({
        by: ['planId'],
        where: { status: PaymentStatus.VERIFIED },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.scoped.payment.groupBy({
        by: ['method'],
        where: { status: PaymentStatus.VERIFIED },
        _sum: { amount: true },
        _count: { _all: true },
      }),
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
    const [
      ticketsDisponibles,
      abonnesActifs,
      echeancesProches,
      paiementsEnAttente,
      plusAncienEnAttente,
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
      ]);

    return {
      vouchersByStatus,
      revenue: { today: revenueToday, thisWeek: revenueThisWeek, thisMonth: revenueThisMonth },
      revenueByPlan,
      revenueByMethod,
      recentPayments,
      recentCustomers,
      connectedClients: hotspotActiveUsers.length,
      ticketsDisponibles,
      abonnesActifs,
      echeancesProches,
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
