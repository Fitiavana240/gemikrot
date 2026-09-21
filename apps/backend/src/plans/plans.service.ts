import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Plan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { PlanProvisioningService } from './plan-provisioning.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { CreatePlanDto } from './dto/create-plan.dto.js';
import type { UpdatePlanDto } from './dto/update-plan.dto.js';

function slugifyProfileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
}

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: PlanProvisioningService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  findAll(): Promise<Plan[]> {
    return this.prisma.scoped.plan.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string): Promise<Plan> {
    const plan = await this.prisma.scoped.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException(`Plan ${id} introuvable`);
    return plan;
  }

  /**
   * Crée l'offre en base puis la projette sur User Manager. Si l'écriture
   * RouterOS échoue, la ligne Postgres est annulée pour ne jamais laisser une
   * offre "orpheline" sans profil réseau (Section 8).
   *
   * Le profil est créé sur le routeur par défaut : la politique de réplication
   * entre sites (tarifs communs ou par site) n'est pas encore arbitrée, et
   * un seul routeur est déployé aujourd'hui.
   *
   * Les nouvelles offres n'ont plus de profil HotSpot : leur validité est
   * calendaire et tenue par User Manager. Les offres existantes gardent le
   * leur, et gagnent un profil User Manager à leur première réconciliation.
   */
  async create(dto: CreatePlanDto): Promise<Plan> {
    const mikrotikProfileName = await this.reserveProfileName(dto.name);

    const plan = await this.prisma.scoped.plan.create({
      data: {
        tenantId: this.tenantContext.requireTenantId(),
        name: dto.name,
        description: dto.description,
        price: dto.price,
        validityDurationSeconds: dto.validityDurationSeconds,
        startsWhen: dto.startsWhen,
        rateLimitRxBps: dto.rateLimitRxBps,
        rateLimitTxBps: dto.rateLimitTxBps,
        transferLimitBytes: dto.transferLimitBytes,
        maxSharedUsers: dto.maxSharedUsers,
        kind: dto.subscriptionPeriodDays ? 'SUBSCRIPTION' : 'TICKET',
        subscriptionPeriodDays: dto.subscriptionPeriodDays,
        sessionTimeoutSeconds: dto.validityDurationSeconds,
        mikrotikProfileName,
      },
    });

    try {
      await this.provisioning.reconcile(plan.id);
    } catch (error) {
      await this.prisma.scoped.plan.delete({ where: { id: plan.id } });
      throw error;
    }

    return this.findOne(plan.id);
  }

  /**
   * La base est écrite d'abord, le routeur ensuite : la réconciliation lit
   * l'offre telle qu'elle vient d'être enregistrée, et ne peut donc pas
   * appliquer un prix ou une validité que Postgres n'aurait pas retenus.
   */
  async update(id: string, dto: UpdatePlanDto): Promise<Plan> {
    await this.findOne(id);

    await this.prisma.scoped.plan.update({
      where: { id },
      data: {
        description: dto.description,
        price: dto.price,
        validityDurationSeconds: dto.validityDurationSeconds,
        startsWhen: dto.startsWhen,
        rateLimitRxBps: dto.rateLimitRxBps,
        rateLimitTxBps: dto.rateLimitTxBps,
        transferLimitBytes: dto.transferLimitBytes,
        maxSharedUsers: dto.maxSharedUsers,
        subscriptionPeriodDays: dto.subscriptionPeriodDays,
        sessionTimeoutSeconds: dto.validityDurationSeconds,
        // Poser un prix vaut confirmation : le drapeau dit << ce prix a ete
        // devine a l'import, relisez-le >>, et c'est exactement ce que
        // l'exploitant vient de faire. Sans cela il ne retomberait jamais, et
        // l'offre resterait bloquee hors du tarif public.
        priceNeedsReview: dto.price == null ? undefined : false,
      },
    });

    await this.provisioning.reconcile(id);
    return this.findOne(id);
  }

  async archive(id: string): Promise<Plan> {
    await this.findOne(id);
    return this.prisma.scoped.plan.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  /**
   * Supprime l'offre pour de bon.
   *
   * Archiver ne repond pas a tout. Un doublon, un essai, une offre creee de
   * travers restent dans la liste et continuent d'encombrer l'ecran et le
   * rapprochement des profils : on les relit a chaque fois pour conclure a
   * chaque fois qu'elles ne servent a rien. Celles-la se suppriment.
   *
   * **Le profil du routeur n'est pas touche.** C'est lui qui sert les clients
   * connectes : l'effacer au passage couperait des gens au nom d'un menage
   * dans une liste. Il reste sur le routeur et reapparait du cote des
   * profils sans offre, ou un bouton le remet au tarif.
   *
   * Refuse des qu'une vente s'y rattache, et ce n'est pas de la prudence de
   * principe : un paiement dont l'offre a disparu est une recette qu'on ne
   * sait plus rattacher a rien. La base le refuserait de toute facon, avec un
   * message que personne ne peut lire ; celui-ci nomme ce qui retient
   * l'offre et dit que l'archivage est la reponse.
   */
  async supprimer(id: string, adminUserId?: string): Promise<{ id: string; nom: string }> {
    const plan = await this.findOne(id);

    const [tickets, lots, paiements, abonnements] = await Promise.all([
      this.prisma.scoped.voucher.count({ where: { planId: id } }),
      this.prisma.scoped.voucherBatch.count({ where: { planId: id } }),
      this.prisma.scoped.payment.count({ where: { planId: id } }),
      this.prisma.scoped.subscription.count({ where: { planId: id } }),
    ]);

    const retenues: string[] = [];
    if (tickets) retenues.push(`${tickets} ticket(s)`);
    if (lots) retenues.push(`${lots} lot(s)`);
    if (paiements) retenues.push(`${paiements} paiement(s)`);
    if (abonnements) retenues.push(`${abonnements} abonnement(s)`);

    if (retenues.length > 0) {
      throw new ConflictException(
        `L'offre « ${plan.name} » ne peut pas être supprimée : ${retenues.join(
          ', ',
        )} s'y rattachent, et leur historique disparaîtrait avec elle. Archivez-la : elle sort de la vente, les ventes passées restent.`,
      );
    }

    await this.prisma.scoped.plan.delete({ where: { id } });

    await this.audit.log({
      adminUserId,
      action: 'DELETE_PLAN',
      targetType: 'Plan',
      targetId: id,
      payloadDiff: { nom: plan.name, profil: plan.mikrotikProfileName, prix: plan.price.toString() },
    });

    return { id, nom: plan.name };
  }

  /** Dérive un nom de profil RouterOS à partir du nom commercial. */
  private async reserveProfileName(planName: string): Promise<string> {
    const candidate = slugifyProfileName(planName);
    const collision = await this.prisma.scoped.plan.findFirst({
      where: { mikrotikProfileName: candidate },
    });
    if (collision) {
      // Deux noms commerciaux distincts (ex: accents/casse différents)
      // peuvent se réduire au même identifiant RouterOS : signalé plutôt
      // que masqué silencieusement par un suffixe auto-généré.
      throw new ConflictException(
        `Le profil RouterOS dérivé de "${planName}" existe déjà (${candidate})`,
      );
    }
    return candidate;
  }
}
