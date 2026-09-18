import { Inject, Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import type { IMikrotikService } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { MIKROTIK_SERVICE } from '../mikrotik/mikrotik.constants.js';

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
    @Inject(MIKROTIK_SERVICE) private readonly mikrotik: IMikrotikService,
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
      this.prisma.voucher.groupBy({ by: ['status'], _count: { _all: true } }),
      this.sumVerifiedSince(startOfDay()),
      this.sumVerifiedSince(startOfWeek()),
      this.sumVerifiedSince(startOfMonth()),
      this.prisma.payment.groupBy({
        by: ['planId'],
        where: { status: PaymentStatus.VERIFIED },
        _sum: { amountAr: true },
        _count: { _all: true },
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: { status: PaymentStatus.VERIFIED },
        _sum: { amountAr: true },
        _count: { _all: true },
      }),
      this.prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.customer.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      this.mikrotik.getHotspotActiveUsers().catch(() => []),
    ]);

    return {
      vouchersByStatus,
      revenue: { today: revenueToday, thisWeek: revenueThisWeek, thisMonth: revenueThisMonth },
      revenueByPlan,
      revenueByMethod,
      recentPayments,
      recentCustomers,
      connectedClients: hotspotActiveUsers.length,
    };
  }

  private async sumVerifiedSince(since: Date): Promise<string> {
    const result = await this.prisma.payment.aggregate({
      where: { status: PaymentStatus.VERIFIED, verifiedAt: { gte: since } },
      _sum: { amountAr: true },
    });
    return (result._sum.amountAr ?? 0).toString();
  }
}
