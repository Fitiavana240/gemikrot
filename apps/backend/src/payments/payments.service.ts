import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Payment, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { AuditService } from '../audit/audit.service.js';
import { VouchersService } from '../vouchers/vouchers.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './providers/payment-provider.interface.js';
import type { CreatePaymentDto } from './dto/create-payment.dto.js';


/**
 * Masque la reference d'un paiement.
 *
 * La reference Mobile Money sert a **retrouver un acces** : qui la connait
 * peut, sur la page publique, se faire rendre le code d'un ticket deja
 * vendu. Elle n'a donc rien a faire en clair sur l'ecran d'un role qui ne
 * valide pas les paiements.
 *
 * Les quatre derniers caracteres restent visibles, pour que l'operateur
 * puisse rapprocher la ligne du bordereau que le client lui montre sans
 * pouvoir s'en servir seul.
 */
export function masquerReference(reference: string): string {
  if (reference.length <= 4) return '••••';
  return `••••${reference.slice(-4)}`;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vouchers: VouchersService,
    private readonly subscriptions: SubscriptionsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * La liste, avec la reference masquee pour qui ne valide pas les paiements.
   * Le masquage est fait ici et non a l'affichage : une valeur qui n'a pas
   * quitte le serveur ne peut pas etre lue dans la reponse reseau.
   */
  async findAll(voirReferences = false): Promise<Payment[]> {
    const paiements = await this.prisma.scoped.payment.findMany({
      orderBy: { createdAt: 'desc' },
    });
    if (voirReferences) return paiements;
    return paiements.map((p) => ({ ...p, reference: masquerReference(p.reference) }));
  }

  async findOne(id: string): Promise<Payment> {
    const payment = await this.prisma.scoped.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException(`Paiement ${id} introuvable`);
    return payment;
  }

  async create(dto: CreatePaymentDto): Promise<Payment> {
    const [customer, plan] = await Promise.all([
      this.prisma.scoped.customer.findUnique({ where: { id: dto.customerId } }),
      this.prisma.scoped.plan.findUnique({ where: { id: dto.planId } }),
    ]);
    if (!customer) throw new NotFoundException(`Client ${dto.customerId} introuvable`);
    if (!plan) throw new NotFoundException(`Plan ${dto.planId} introuvable`);

    const duplicate = await this.prisma.scoped.payment.findFirst({
      where: { method: dto.method, reference: dto.reference },
    });
    if (duplicate) {
      throw new ConflictException(
        `Un paiement existe déjà pour ${dto.method}/${dto.reference} (Section 24 : idempotence)`,
      );
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: this.tenantContext.requireTenantId() },
      select: { currency: true },
    });

    return this.prisma.scoped.payment.create({
      data: {
        tenantId: this.tenantContext.requireTenantId(),
        currency: tenant.currency,
        customerId: dto.customerId,
        planId: dto.planId,
        subscriptionId: dto.subscriptionId,
        amount: dto.amount,
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

    const verification = await this.provider.verify(payment.reference, Number(payment.amount));
    if (!verification.verified) {
      await this.markStatus(payment.id, PaymentStatus.REJECTED, adminUserId, 'FAILURE');
      throw new ConflictException(`Paiement refusé : ${verification.reason ?? 'non vérifié'}`);
    }

    // Un paiement solde soit une période d'abonnement, soit un ticket.
    if (payment.subscriptionId) {
      return this.verifySubscriptionPayment(payment, adminUserId);
    }

    /**
     * Un réabonnement ne vend rien : il rachète du temps sur un accès qui
     * existe déjà.
     *
     * Passer par le chemin ordinaire tirerait un ticket du stock — un code
     * aléatoire là où le client attend le sien — ou buterait sur `activate`,
     * qui refuse à raison tout ticket déjà vendu.
     */
    if (payment.renewsVoucherId) {
      return this.verifierReabonnement(payment, adminUserId);
    }

    // Le ticket peut avoir été **réservé à la déclaration** : un achat en
    // ligne crée le sien, au nom du client et avec sa référence pour mot de
    // passe. Tirer alors un ticket du stock rendrait un code aléatoire à la
    // place du nom, et laisserait le ticket réservé orphelin.
    const voucher = payment.voucherId
      ? await this.vouchers.findOne(payment.voucherId)
      : ((await this.vouchers.findAvailableForPlan(payment.planId)) ??
        (await this.vouchers.generateSingle(payment.planId)));

    const activated = await this.vouchers.activate(voucher.id, {
      customerId: payment.customerId,
      adminUserId,
    });

    const claimed = await this.prisma.scoped.payment.updateMany({
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
      payloadDiff: { voucherId: activated.id, amount: payment.amount.toString() },
    });

    return this.findOne(payment.id);
  }

  /**
   * Réabonnement d'un accès acheté en ligne.
   *
   * Même garantie d'idempotence que partout ailleurs : l'update conditionnel
   * sur `PENDING` est pris **avant** de toucher au routeur, de sorte que deux
   * vérifications concurrentes ne puissent pas empiler deux périodes pour un
   * seul paiement.
   */
  private async verifierReabonnement(payment: Payment, adminUserId: string): Promise<Payment> {
    const claimed = await this.prisma.scoped.payment.updateMany({
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

    const prolonge = await this.vouchers.renouveler(payment.renewsVoucherId!, { adminUserId });

    await this.audit.log({
      adminUserId,
      action: 'VERIFY_PAYMENT',
      targetType: 'Payment',
      targetId: payment.id,
      payloadDiff: {
        reabonnement: prolonge.code,
        echeance: prolonge.expiresAt?.toISOString() ?? null,
        amount: payment.amount.toString(),
      },
    });

    return this.findOne(payment.id);
  }

  /**
   * Renouvellement d'abonnement : même garantie d'idempotence que pour un
   * ticket — l'update conditionnel sur `PENDING` empêche deux vérifications
   * concurrentes de prolonger deux fois la même période.
   */
  private async verifySubscriptionPayment(payment: Payment, adminUserId: string): Promise<Payment> {
    const claimed = await this.prisma.scoped.payment.updateMany({
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
        amount: payment.amount.toString(),
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
    const updated = await this.prisma.scoped.payment.update({ where: { id }, data: { status } });
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
