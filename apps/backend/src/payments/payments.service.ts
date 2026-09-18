import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Payment, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { VouchersService } from '../vouchers/vouchers.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './providers/payment-provider.interface.js';
import type { CreatePaymentDto } from './dto/create-payment.dto.js';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vouchers: VouchersService,
    private readonly subscriptions: SubscriptionsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  findAll(): Promise<Payment[]> {
    return this.prisma.payment.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException(`Paiement ${id} introuvable`);
    return payment;
  }

  async create(dto: CreatePaymentDto): Promise<Payment> {
    const [customer, plan] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: dto.customerId } }),
      this.prisma.plan.findUnique({ where: { id: dto.planId } }),
    ]);
    if (!customer) throw new NotFoundException(`Client ${dto.customerId} introuvable`);
    if (!plan) throw new NotFoundException(`Plan ${dto.planId} introuvable`);

    const duplicate = await this.prisma.payment.findUnique({
      where: { method_reference: { method: dto.method, reference: dto.reference } },
    });
    if (duplicate) {
      throw new ConflictException(
        `Un paiement existe déjà pour ${dto.method}/${dto.reference} (Section 24 : idempotence)`,
      );
    }

    return this.prisma.payment.create({
      data: {
        customerId: dto.customerId,
        planId: dto.planId,
        subscriptionId: dto.subscriptionId,
        amountAr: dto.amountAr,
        method: dto.method,
        reference: dto.reference,
      },
    });
  }

  /**
   * Pipeline Section 24 : vérification → attribution/génération du voucher →
   * provisioning User Manager → activation. L'idempotence est garantie à
   * deux niveaux : la contrainte unique `(method, reference)` empêche deux
   * paiements pour la même référence, et l'update conditionnel ci-dessous
   * empêche qu'un même paiement PENDING soit vérifié deux fois en parallèle.
   */
  async verifyPayment(paymentId: string, adminUserId: string): Promise<Payment> {
    const payment = await this.findOne(paymentId);
    if (payment.status !== PaymentStatus.PENDING) {
      throw new ConflictException(`Paiement ${paymentId} déjà traité (${payment.status})`);
    }

    const verification = await this.provider.verify(payment.reference, Number(payment.amountAr));
    if (!verification.verified) {
      await this.markStatus(payment.id, PaymentStatus.REJECTED, adminUserId, 'FAILURE');
      throw new ConflictException(`Paiement refusé : ${verification.reason ?? 'non vérifié'}`);
    }

    // Un paiement solde soit une période d'abonnement, soit un ticket.
    if (payment.subscriptionId) {
      return this.verifySubscriptionPayment(payment, adminUserId);
    }

    const voucher =
      (await this.vouchers.findAvailableForPlan(payment.planId)) ??
      (await this.vouchers.generateSingle(payment.planId));

    const activated = await this.vouchers.activate(voucher.id, {
      customerId: payment.customerId,
      adminUserId,
    });

    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING },
      data: {
        status: PaymentStatus.VERIFIED,
        voucherId: activated.id,
        verifiedByAdminId: adminUserId,
        verifiedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      // Un autre appel concurrent a déjà vérifié ce paiement entre-temps :
      // le voucher qu'on vient d'activer reste attribué (pas de perte), mais
      // on ne duplique pas la vérification côté paiement.
      throw new ConflictException(`Paiement ${paymentId} déjà vérifié par une requête concurrente`);
    }

    await this.audit.log({
      adminUserId,
      action: 'VERIFY_PAYMENT',
      targetType: 'Payment',
      targetId: payment.id,
      payloadDiff: { voucherId: activated.id, amountAr: payment.amountAr.toString() },
    });

    return this.findOne(payment.id);
  }

  /**
   * Renouvellement d'abonnement : même garantie d'idempotence que pour un
   * ticket — l'update conditionnel sur `PENDING` empêche deux vérifications
   * concurrentes de prolonger deux fois la même période.
   */
  private async verifySubscriptionPayment(payment: Payment, adminUserId: string): Promise<Payment> {
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING },
      data: {
        status: PaymentStatus.VERIFIED,
        verifiedByAdminId: adminUserId,
        verifiedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException(`Paiement ${payment.id} déjà vérifié par une requête concurrente`);
    }

    await this.subscriptions.renew(payment.subscriptionId!, payment, adminUserId);

    await this.audit.log({
      adminUserId,
      action: 'VERIFY_PAYMENT',
      targetType: 'Payment',
      targetId: payment.id,
      payloadDiff: {
        subscriptionId: payment.subscriptionId,
        amountAr: payment.amountAr.toString(),
      },
    });
    return this.findOne(payment.id);
  }

  async reject(paymentId: string, adminUserId: string, reason?: string): Promise<Payment> {
    const payment = await this.findOne(paymentId);
    if (payment.status !== PaymentStatus.PENDING) {
      throw new ConflictException(`Paiement ${paymentId} déjà traité (${payment.status})`);
    }
    return this.markStatus(payment.id, PaymentStatus.REJECTED, adminUserId, 'SUCCESS', reason);
  }

  private async markStatus(
    id: string,
    status: PaymentStatus,
    adminUserId: string,
    result: 'SUCCESS' | 'FAILURE',
    reason?: string,
  ): Promise<Payment> {
    const updated = await this.prisma.payment.update({ where: { id }, data: { status } });
    await this.audit.log({
      adminUserId,
      action: 'REJECT_PAYMENT',
      targetType: 'Payment',
      targetId: id,
      payloadDiff: reason ? ({ reason } as Prisma.InputJsonValue) : undefined,
      result,
    });
    return updated;
  }
}
