import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaymentStatus, PlanKind, PlanStatus, TenantStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import {
  isUsablePhone,
  isUsableReference,
  normalizePhone,
  normalizeReference,
} from './payment-normalization.js';

export interface PublicTenantView {
  wifiName: string;
  logoUrl: string | null;
  currency: string;
  plans: {
    id: string;
    name: string;
    description: string | null;
    price: string;
    validityDurationSeconds: number;
    maxSharedUsers: number | null;
  }[];
  paymentAccounts: { id: string; provider: string; phoneNumber: string; accountName: string }[];
  /**
   * Numéro WhatsApp d'assistance, ou `null`.
   *
   * `null` plutôt qu'une chaîne vide : la page n'affiche le lien que s'il y
   * a un numéro, et une porte d'assistance qui ne mène nulle part est pire
   * que pas d'assistance annoncée.
   */
  supportWhatsapp: string | null;
}

export type ClaimState = 'EN_ATTENTE' | 'VALIDE' | 'REFUSE';

export interface ClaimView {
  state: ClaimState;
  /** Rendu seulement une fois le paiement vérifié. */
  accessCode: string | null;
  planName: string;
  amount: string;
  currency: string;
  createdAt: string;
}

/**
 * Ce que voit un client qui n'est pas connecté : la vitrine de l'exploitant
 * et le suivi de son paiement.
 *
 * **Cloisonnement.** Aucune requête ici ne s'appuie sur un jeton — il n'y en
 * a pas. Chaque méthode a donc pour corps un unique `runAsTenant`, explicite
 * et greppable, et n'utilise à l'intérieur que `scopedStrict`, qui refuse de
 * travailler hors d'un exploitant. Le cloisonnement de la plateforme ne doit
 * pas dépendre de l'ordre d'exécution d'un intercepteur.
 */
@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Vitrine : la marque, les offres à la vente, et où payer.
   *
   * Construite à la main, jamais renvoyée depuis une entité : l'identifiant
   * de l'exploitant, ses domaines, son statut et ses puces désactivées n'ont
   * rien à faire dans une réponse publique.
   */
  async getTenantView(slug: string): Promise<PublicTenantView> {
    const tenant = await this.requireActiveTenant(slug);

    return this.tenantContext.runAsTenant(tenant.id, async () => {
      const [plans, accounts] = await Promise.all([
        this.prisma.scopedStrict.plan.findMany({
          where: { status: PlanStatus.ACTIVE, kind: PlanKind.TICKET },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            validityDurationSeconds: true,
            maxSharedUsers: true,
          },
          orderBy: { price: 'asc' },
        }),
        this.prisma.scopedStrict.mobileMoneyAccount.findMany({
          // Une puce retirée ne doit plus être proposée : l'argent y
          // arriverait sans que personne ne le voie.
          where: { isActive: true },
          select: { id: true, provider: true, phoneNumber: true, accountName: true },
        }),
      ]);

      return {
        wifiName: tenant.wifiName,
        logoUrl: tenant.logoUrl,
        currency: tenant.currency,
        supportWhatsapp: tenant.supportWhatsapp || null,
        plans: plans.map((plan) => ({ ...plan, price: plan.price.toString() })),
        paymentAccounts: accounts,
      };
    });
  }

  /**
   * Le client déclare avoir payé. Rien ne lui est ouvert à ce stade : un
   * paiement en attente est enregistré, que la lecture des SMS ou un admin
   * viendra confirmer.
   */
  async claim(
    slug: string,
    input: { planId: string; accountId: string; phone: string; reference: string },
  ): Promise<{ token: string; state: ClaimState }> {
    const tenant = await this.requireActiveTenant(slug);

    const phone = normalizePhone(input.phone);
    const reference = normalizeReference(input.reference);
    if (!isUsablePhone(phone)) {
      throw new BadRequestException('Numéro de téléphone invalide');
    }
    if (!isUsableReference(reference)) {
      throw new BadRequestException(
        'Référence invalide — entre 4 et 32 lettres ou chiffres, telle qu\'elle figure dans votre SMS',
      );
    }

    return this.tenantContext.runAsTenant(tenant.id, async () => {
      // Le cloisonnement suffit à écarter l'offre d'un autre exploitant :
      // un identifiant recopié d'ailleurs ne sera simplement pas trouvé.
      const plan = await this.prisma.scopedStrict.plan.findFirst({
        where: { id: input.planId, status: PlanStatus.ACTIVE, kind: PlanKind.TICKET },
      });
      if (!plan) throw new NotFoundException('Offre introuvable');

      const account = await this.prisma.scopedStrict.mobileMoneyAccount.findFirst({
        where: { id: input.accountId, isActive: true },
      });
      if (!account) throw new NotFoundException('Moyen de paiement introuvable');

      // Rejouer la même demande ne crée pas un second paiement : le client
      // qui recharge la page retrouve simplement son suivi.
      const existing = await this.prisma.scopedStrict.payment.findFirst({
        where: { reference, method: account.provider },
        include: { claim: true },
      });
      if (existing?.claim) {
        return { token: existing.claim.token, state: this.stateOf(existing.status) };
      }
      if (existing) {
        throw new BadRequestException(
          'Cette référence a déjà été utilisée. Contactez le vendeur si vous pensez que c\'est une erreur.',
        );
      }

      const customer = await this.prisma.scopedStrict.customer.upsert({
        where: { tenantId_phone: { tenantId: tenant.id, phone } },
        update: {},
        // Le nom viendra du SMS de l'opérateur, qui porte celui du payeur.
        create: { tenantId: tenant.id, name: phone, phone },
      });

      const payment = await this.prisma.scopedStrict.payment.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          planId: plan.id,
          amount: plan.price,
          currency: tenant.currency,
          method: account.provider,
          reference,
        },
      });

      const claim = await this.prisma.scopedStrict.paymentClaim.create({
        data: {
          tenantId: tenant.id,
          paymentId: payment.id,
          token: randomBytes(24).toString('base64url'),
          phone,
          reference,
        },
      });

      this.logger.log(`Paiement déclaré : ${plan.name} par ${phone} (${account.provider})`);
      return { token: claim.token, state: 'EN_ATTENTE' as const };
    });
  }

  /** Suivi par jeton, pour le navigateur qui vient de déclarer le paiement. */
  async getClaimByToken(slug: string, token: string): Promise<ClaimView> {
    const tenant = await this.requireActiveTenant(slug);

    return this.tenantContext.runAsTenant(tenant.id, async () => {
      const claim = await this.prisma.scopedStrict.paymentClaim.findFirst({
        where: { token },
        include: { payment: { include: { plan: true, voucher: true } } },
      });
      if (!claim) throw new NotFoundException('Suivi introuvable');
      return this.toView(claim);
    });
  }

  /**
   * Retrouver son accès avec ce qu'on a en main : son numéro et sa
   * référence. C'est une **recherche**, pas une authentification : elle ne
   * crée aucun compte et ne renvoie que ce que le client a déjà payé.
   */
  async lookup(slug: string, input: { phone: string; reference: string }): Promise<ClaimView> {
    const tenant = await this.requireActiveTenant(slug);
    const phone = normalizePhone(input.phone);
    const reference = normalizeReference(input.reference);

    return this.tenantContext.runAsTenant(tenant.id, async () => {
      const claim = await this.prisma.scopedStrict.paymentClaim.findFirst({
        where: { phone, reference },
        include: { payment: { include: { plan: true, voucher: true } } },
      });
      if (!claim) {
        throw new NotFoundException(
          'Aucun paiement trouvé pour ce numéro et cette référence. Vérifiez votre SMS.',
        );
      }
      return this.toView(claim);
    });
  }

  /**
   * L'exploitant est résolu sur le client brut : `Tenant` n'est pas un
   * modèle cloisonné, et c'est justement cette requête qui détermine le
   * cloisonnement de tout le reste.
   *
   * Un exploitant inconnu et un exploitant non activé donnent la même
   * réponse — 404 — pour ne pas révéler quels comptes existent.
   */
  private async requireActiveTenant(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status !== TenantStatus.ACTIVE) {
      throw new NotFoundException('Page introuvable');
    }
    return tenant;
  }

  private toView(claim: {
    createdAt: Date;
    payment: {
      status: PaymentStatus;
      amount: unknown;
      currency: string;
      plan: { name: string };
      voucher: { code: string } | null;
    };
  }): ClaimView {
    const state = this.stateOf(claim.payment.status);
    return {
      state,
      // Le code n'est rendu qu'après vérification : un jeton de suivi peut
      // être partagé, il ne doit pas donner d'accès à lui seul.
      accessCode: state === 'VALIDE' ? (claim.payment.voucher?.code ?? null) : null,
      planName: claim.payment.plan.name,
      amount: String(claim.payment.amount),
      currency: claim.payment.currency,
      createdAt: claim.createdAt.toISOString(),
    };
  }

  private stateOf(status: PaymentStatus): ClaimState {
    if (status === PaymentStatus.VERIFIED) return 'VALIDE';
    if (status === PaymentStatus.PENDING) return 'EN_ATTENTE';
    return 'REFUSE';
  }
}
