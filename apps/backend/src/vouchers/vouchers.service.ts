import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Voucher, VoucherStatus, VoucherTarget } from '@prisma/client';
import { MikrotikNotFoundError } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { AbonnementPlateformeService } from '../tenants/abonnement-plateforme.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import { parseRouterTime } from '../routers/router-time.util.js';
import { PlanProvisioningService } from '../plans/plan-provisioning.service.js';
import { RouterAccessService } from '../routers/router-access.service.js';
import { TicketTemplatesService } from '../tickets/ticket-templates.service.js';
import { PlancheRouteurService, type RapportPlanches } from '../tickets/planche-routeur.service.js';
import type { CreateVoucherBatchDto } from './dto/create-voucher-batch.dto.js';
import { generateVoucherCode } from './voucher-code.util.js';

const MAX_CODE_COLLISION_RETRIES = 5;

@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clients: MikrotikClientFactory,
    private readonly provisioning: PlanProvisioningService,
    private readonly access: RouterAccessService,
    private readonly tenantContext: TenantContextService,
    private readonly modèles: TicketTemplatesService,
    private readonly planches: PlancheRouteurService,
    private readonly abonnement: AbonnementPlateformeService,
  ) {}

  private readonly logger = new Logger(VouchersService.name);

  /**
   * `scope` distingue les deux générations : `um` pour les tickets servis par
   * User Manager, `legacy` pour ceux d'avant la bascule, encore sur le
   * HotSpot local et sans échéance.
   */
  findAll(
    filter: { status?: VoucherStatus; planId?: string; scope?: 'um' | 'legacy' } = {},
  ): Promise<Voucher[]> {
    const { scope, ...rest } = filter;
    return this.prisma.scoped.voucher.findMany({
      where: {
        ...rest,
        ...(scope === 'um' ? { umUsername: { not: null } } : {}),
        ...(scope === 'legacy' ? { umUsername: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Tickets expirés. Le statut seul ne suffit pas : entre deux
   * réconciliations, un ticket dont l'échéance est passée porte encore
   * VENDU. Le routeur, lui, a déjà cessé de le servir — la liste doit dire
   * la même chose que le réseau.
   */
  findExpired(): Promise<Voucher[]> {
    return this.prisma.scoped.voucher.findMany({
      where: {
        OR: [
          { status: VoucherStatus.EXPIRED },
          {
            status: { in: [VoucherStatus.SOLD, VoucherStatus.ACTIVE] },
            expiresAt: { lt: new Date() },
          },
        ],
      },
      orderBy: { expiresAt: 'desc' },
    });
  }

  /**
   * Répartition par offre — un profil User Manager, une offre. Donne d'un
   * coup d'œil ce qui reste à vendre et ce qui est consommé.
   */
  async countByPlan(): Promise<
    {
      planId: string;
      planName: string;
      price: string;
      umProfileName: string | null;
      validityDurationSeconds: number;
      counts: Record<string, number>;
      total: number;
    }[]
  > {
    const [plans, grouped] = await Promise.all([
      this.prisma.scoped.plan.findMany({
        select: {
          id: true,
          name: true,
          price: true,
          umProfileName: true,
          validityDurationSeconds: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.scoped.voucher.groupBy({ by: ['planId', 'status'], _count: { _all: true } }),
    ]);

    return plans.map((plan) => {
      const rows = grouped.filter((row) => row.planId === plan.id);
      const counts: Record<string, number> = {};
      let total = 0;
      for (const row of rows) {
        counts[row.status] = row._count._all;
        total += row._count._all;
      }
      return {
        planId: plan.id,
        planName: plan.name,
        price: plan.price.toString(),
        umProfileName: plan.umProfileName,
        validityDurationSeconds: plan.validityDurationSeconds,
        counts,
        total,
      };
    });
  }

  async findOne(id: string): Promise<Voucher> {
    const voucher = await this.prisma.scoped.voucher.findUnique({ where: { id } });
    if (!voucher) throw new NotFoundException(`Voucher ${id} introuvable`);
    return voucher;
  }

  async findByCode(code: string): Promise<Voucher> {
    const voucher = await this.prisma.scoped.voucher.findUnique({ where: { code } });
    if (!voucher) throw new NotFoundException(`Voucher ${code} introuvable`);
    return voucher;
  }

  /** Un voucher CREATED déjà généré et pas encore attribué à un client. */
  /**
   * Un ticket du stock, pour une vente au comptoir.
   *
   * `customerId: null` porte plus qu'il n'y paraît depuis l'achat en ligne :
   * une déclaration de paiement **réserve** son ticket au nom du client, et
   * il reste `CREATED` jusqu'à la vérification. Sans cette condition, une
   * vente au comptoir le tirerait du stock et remettrait à un passant
   * l'identifiant que quelqu'un d'autre vient de choisir.
   */
  findAvailableForPlan(planId: string): Promise<Voucher | null> {
    return this.prisma.scoped.voucher.findFirst({
      where: { planId, status: VoucherStatus.CREATED, customerId: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Génère un ticket à la volée, hors lot, et le provisionne sur le routeur
   * comme le fait un lot. C'est ce chemin qu'emprunte un paiement vérifié
   * quand aucun ticket n'est disponible en stock : le client doit repartir
   * avec un code qui fonctionne, pas avec une ligne en base.
   */
  async generateSingle(planId: string, routerId?: string): Promise<Voucher> {
    const plan = await this.getActivePlan(planId);
    const voucher = await this.createVoucherWithUniqueCode({
      planId: plan.id,
      price: plan.price,
    });
    const [provisioned] = await this.provisionOnUserManager(
      [voucher],
      plan,
      routerId ?? (await this.getDefaultRouterId()),
    );
    return provisioned;
  }

  /** Génération synchrone d'un lot (Section 18). Adapté jusqu'à ~1000 vouchers. */
  async generateBatch(dto: CreateVoucherBatchDto, adminUserId: string): Promise<Voucher[]> {
    // Générer un lot, c'est mettre du stock en vente : c'est là que
    // l'abonnement à la plateforme se fait sentir, et nulle part ailleurs.
    // Bloquer une correction de numéro de téléphone pour une facture impayée
    // serait une punition sans rapport avec la faute.
    await this.abonnement.exigerAbonnementValide(this.tenantContext.requireTenantId());

    const plan = await this.getActivePlan(dto.planId);
    const routerId = dto.routerId ?? (await this.getDefaultRouterId());

    // User Manager par défaut : lui seul tient une validité calendaire, qui
    // continue de courir client déconnecté. Le HotSpot reste possible pour
    // les routeurs qui n'ont pas le paquet, et pour les tickets courts.
    const target = dto.target ?? VoucherTarget.USER_MANAGER;

    const batch = await this.prisma.scoped.voucherBatch.create({
      data: {
        tenantId: this.tenantContext.requireTenantId(),
        routerId,
        planId: plan.id,
        quantity: dto.quantity,
        prefix: dto.prefix,
        target,
        createdByAdminId: adminUserId,
        status: 'PENDING',
        jobs: { create: { total: dto.quantity, status: 'running', startedAt: new Date() } },
      },
      include: { jobs: true },
    });

    try {
      const vouchers: Voucher[] = [];
      for (let i = 0; i < dto.quantity; i += 1) {
        vouchers.push(
          await this.createVoucherWithUniqueCode({
            planId: plan.id,
            price: plan.price,
            batchId: batch.id,
            prefix: dto.prefix,
          }),
        );
      }

      // Les comptes sont créés sur le routeur dès la génération : un ticket
      // imprimé fonctionne immédiatement, sans qu'un vendeur ait à l'activer
      // dans la console. La validité ne court qu'à la première connexion, un
      // ticket invendu ne s'use donc pas.
      const provisioned =
        target === VoucherTarget.USER_MANAGER
          ? await this.provisionOnUserManager(vouchers, plan, routerId)
          : await this.provisionOnHotspot(vouchers, plan, routerId);

      // La planche A4 part sur le routeur, là où vivent les comptes qu'on
      // vient de créer. Les chemins sont gardés sur le lot : un lot généré la
      // veille doit pouvoir retrouver sa feuille, et le PDF n'est pas ici.
      const planches = await this.déposerPlanches(provisioned, plan, routerId);

      await this.prisma.scoped.voucherBatch.update({
        where: { id: batch.id },
        data: { status: 'COMPLETED', planches: planches.planches.map((p) => p.chemin) },
      });
      await this.prisma.scoped.voucherJob.update({
        where: { id: batch.jobs[0].id },
        data: { processed: vouchers.length, status: 'completed', finishedAt: new Date() },
      });
      await this.audit.log({
        adminUserId,
        action: 'CREATE_VOUCHER_BATCH',
        targetType: 'VoucherBatch',
        targetId: batch.id,
        payloadDiff: { planId: plan.id, quantity: dto.quantity, routerId },
      });

      return provisioned;
    } catch (error) {
      await this.prisma.scoped.voucherBatch.update({ where: { id: batch.id }, data: { status: 'FAILED' } });
      await this.prisma.scoped.voucherJob.update({
        where: { id: batch.jobs[0].id },
        data: { status: 'failed', errorMessage: String(error), finishedAt: new Date() },
      });
      throw error;
    }
  }

  /**
   * Provisionne le voucher comme compte HotSpot et l'attribue au client.
   * Appelé par `PaymentsService` une fois le paiement vérifié (Section 24).
   *
   * `code` sert à la fois de nom d'utilisateur et de mot de passe RouterOS
   * (Section 6 : un seul champ à saisir côté client).
   */
  /**
   * Rachète du temps sur un accès qui existe déjà.
   *
   * `activate` ne sait pas faire : elle refuse tout ticket qui n'est plus
   * `CREATED`, et c'est juste — vendre deux fois le même ticket est une
   * erreur. Un réabonnement n'est pas une seconde vente : le client garde son
   * identifiant, son mot de passe et son compte, et rachète de la durée.
   *
   * **C'est le routeur qui calcule la nouvelle échéance**, pas nous. Une
   * attribution de plus empile une période sur celle en cours, et `end-time`
   * en revient calculé : notre addition de jours ne ferait que diverger de
   * ce qu'il applique réellement.
   *
   * Et jamais plus tôt que ce qui court déjà. Un client qui se réabonne en
   * avance garde ses jours restants ; si le routeur rendait une échéance
   * antérieure — parce qu'il repart de maintenant au lieu d'empiler — la
   * retenir lui volerait ces jours-là, en silence.
   */
  async renouveler(
    voucherId: string,
    params: { adminUserId?: string; reference?: string } = {},
  ): Promise<Voucher> {
    const voucher = await this.findOne(voucherId);
    const plan = await this.getActivePlan(voucher.planId);

    if (!voucher.umUsername) {
      throw new ConflictException(
        `« ${voucher.code} » n'a pas de compte User Manager : seul un accès acheté en ligne se réabonne.`,
      );
    }

    const routerId = await this.getDefaultRouterId();
    const { profileName } = await this.provisioning.reconcile(plan.id, routerId);
    const mikrotik = await this.clients.forRouter(routerId);

    /**
     * Le mot de passe devient la reference du nouveau paiement.
     *
     * C'est celle que le client vient de taper, donc celle qu'il a sous les
     * yeux ; l'ancienne dort dans un SMS d'il y a un mois. Pose **sur le
     * routeur d'abord** : c'est lui qui authentifie, et une base qui
     * annoncerait un mot de passe que le routeur refuse serait pire que pas
     * de changement du tout.
     */
    if (params.reference) {
      await mikrotik.updateUserManagerUser({
        username: voucher.umUsername,
        password: params.reference,
      });
    }

    const assignment = await mikrotik.assignProfile({
      username: voucher.umUsername,
      profileName,
    });
    const clock = await mikrotik.getClock();
    const rendue = parseRouterTime(assignment.endTime, clock.gmtOffset);
    const echeance =
      rendue && voucher.expiresAt && rendue < voucher.expiresAt ? voucher.expiresAt : rendue;

    const prolonge = await this.prisma.scoped.voucher.update({
      where: { id: voucher.id },
      data: {
        // Un ticket expiré redevient actif : c'est tout l'objet du geste.
        status: VoucherStatus.ACTIVE,
        // Écrit seulement après que le routeur l'a accepté.
        accessPassword: params.reference ?? voucher.accessPassword,
        umState: assignment.state,
        expiresAt: echeance ?? voucher.expiresAt,
        lastReconciledAt: new Date(),
      },
    });

    await this.audit.log({
      adminUserId: params.adminUserId,
      routerId,
      action: 'RENEW_VOUCHER',
      targetType: 'Voucher',
      targetId: voucher.id,
      payloadDiff: {
        code: voucher.code,
        profil: profileName,
        echeance: echeance?.toISOString() ?? null,
        motDePasseChange: Boolean(params.reference),
      },
    });

    return prolonge;
  }

  async activate(
    voucherId: string,
    params: { customerId: string; deviceId?: string; adminUserId?: string },
  ): Promise<Voucher> {
    const voucher = await this.findOne(voucherId);
    if (voucher.status !== VoucherStatus.CREATED) {
      throw new ConflictException(`Voucher ${voucher.code} n'est plus disponible (${voucher.status})`);
    }
    const plan = await this.getActivePlan(voucher.planId);

    // Le compte existe déjà sur le routeur depuis la génération du lot : le
    // ticket imprimé fonctionnait avant même d'être vendu. Ne reste ici que
    // le rattachement commercial. Un ticket d'avant la bascule n'a pas de
    // compte User Manager : il est provisionné maintenant, sur le HotSpot,
    // pour ne pas changer le comportement de l'existant.
    let expiresAt: Date | null = null;
    let umState: string | null = voucher.umState;

    if (voucher.umUsername) {
      const mikrotik = await this.clients.forDefaultRouter();
      const [assignments, clock] = await Promise.all([
        mikrotik.getUserManagerUserProfiles(voucher.umUsername),
        mikrotik.getClock(),
      ]);
      const current = assignments.find((a) => a.profileName === plan.umProfileName) ?? assignments[0];
      expiresAt = parseRouterTime(current?.endTime, clock.gmtOffset);
      umState = current?.state ?? umState;
    } else if (voucher.target === VoucherTarget.USER_MANAGER) {
      // Acheté en ligne : le compte n'existe pas encore, puisqu'on ne
      // l'ouvre qu'une fois l'argent constaté. Il part sur User Manager,
      // seul à tenir une validité calendaire — celle qui continue de courir
      // même client déconnecté, et que le client a payée.
      const [provisionné] = await this.provisionOnUserManager(
        [voucher],
        plan,
        await this.getDefaultRouterId(),
      );
      expiresAt = provisionné.expiresAt;
      umState = provisionné.umState;
    } else if (voucher.target !== VoucherTarget.HOTSPOT) {
      // Ticket historique : aucun compte n'existe tant qu'il n'est pas
      // vendu, il est créé maintenant. Un ticket HotSpot **pré-créé** au
      // contraire porte déjà son compte depuis la génération — le recréer
      // ici échouerait en conflit, et c'est pour distinguer ces deux cas
      // que `target` existe.
      const mikrotik = await this.clients.forDefaultRouter();
      await mikrotik.createHotspotUser({
        username: voucher.code,
        password: voucher.code,
        profileName: plan.mikrotikProfileName,
        comment: `wifitati:voucher:${voucher.code}`,
      });
    }

    const updated = await this.prisma.scoped.voucher.update({
      where: { id: voucher.id },
      data: {
        status: VoucherStatus.SOLD,
        customerId: params.customerId,
        deviceId: params.deviceId,
        activatedAt: new Date(),
        expiresAt,
        umState,
        // Relu à l'instant quand le compte vient d'être poussé : sans cela
        // un ticket acheté en ligne paraîtrait n'avoir jamais été rapproché.
        lastReconciledAt:
          voucher.umUsername || voucher.target === VoucherTarget.USER_MANAGER
            ? new Date()
            : null,
      },
    });

    await this.audit.log({
      adminUserId: params.adminUserId,
      action: 'ACTIVATE_VOUCHER',
      targetType: 'Voucher',
      targetId: voucher.id,
      payloadDiff: { customerId: params.customerId, planId: plan.id },
    });

    return updated;
  }

  async disable(id: string, adminUserId?: string): Promise<Voucher> {
    const voucher = await this.findOne(id);

    try {
      const mikrotik = await this.clients.forDefaultRouter();
      // Désactivé plutôt que supprimé : le compte reste visible sur le
      // routeur pour tracer ce qui a été vendu.
      if (voucher.umUsername) {
        // Désactiver ne suffit pas : un cookie encore valide rouvre la
        // session sans repasser par RADIUS, donc sans consulter User
        // Manager. Cookies et session en cours partent avec.
        await this.access.revoke(mikrotik, voucher.umUsername);
      } else if (
        // Un ticket HotSpot pré-créé porte son compte dès la génération : il
        // faut le couper même avant vente, sinon un code imprimé mais retiré
        // de la vente continuerait d'ouvrir l'accès. Un ticket historique,
        // lui, n'a de compte qu'une fois vendu.
        voucher.target === VoucherTarget.HOTSPOT ||
        voucher.status === VoucherStatus.SOLD ||
        voucher.status === VoucherStatus.ACTIVE
      ) {
        await mikrotik.setHotspotUserDisabled(voucher.code, true);
        await this.access.purgeCookies(mikrotik, voucher.code);
        await this.access.closeSessions(mikrotik, voucher.code);
      }
    } catch (error) {
      if (!(error instanceof MikrotikNotFoundError)) throw error;
    }

    const updated = await this.prisma.scoped.voucher.update({
      where: { id },
      data: { status: VoucherStatus.DISABLED },
    });
    await this.audit.log({
      adminUserId,
      action: 'DISABLE_USER',
      targetType: 'Voucher',
      targetId: id,
    });
    return updated;
  }

  /**
   * Annule un ticket jamais vendu.
   *
   * **Coupe aussi l'accès sur le routeur.** Ce ne fut pas toujours le cas :
   * la méthode se contentait de changer le statut en base. Or les comptes
   * sont créés dès la génération — c'est ce qui fait qu'un ticket imprimé
   * fonctionne sans être activé — si bien qu'un ticket annulé continuait
   * d'ouvrir l'accès, indéfiniment et sans que rien ne le signale. Un code
   * mal imprimé qu'on croyait retiré restait vendable dans la rue.
   */
  async cancel(id: string, adminUserId?: string): Promise<Voucher> {
    const voucher = await this.findOne(id);
    if (voucher.status !== VoucherStatus.CREATED) {
      throw new ConflictException(
        `Voucher ${voucher.code} déjà attribué : utiliser disable(), pas cancel()`,
      );
    }

    await this.couperAcces(voucher);

    const updated = await this.prisma.scoped.voucher.update({
      where: { id },
      data: { status: VoucherStatus.CANCELLED },
    });
    await this.audit.log({ adminUserId, action: 'CANCEL_VOUCHER', targetType: 'Voucher', targetId: id });
    return updated;
  }

  /**
   * Ferme l'accès d'un ticket sur le routeur, quelle que soit sa cible.
   *
   * Désactiver ne suffit pas : un cookie encore valide rouvre la session sans
   * repasser par RADIUS, donc sans consulter la validité. Cookies et session
   * en cours partent avec.
   *
   * Un compte absent n'est pas une erreur — un ticket historique n'en a pas
   * tant qu'il n'est pas vendu.
   */
  private async couperAcces(voucher: Voucher): Promise<void> {
    try {
      const mikrotik = await this.clients.forDefaultRouter();
      if (voucher.umUsername) {
        await this.access.revoke(mikrotik, voucher.umUsername);
      } else if (voucher.target === VoucherTarget.HOTSPOT) {
        await mikrotik.setHotspotUserDisabled(voucher.code, true);
        await this.access.purgeCookies(mikrotik, voucher.code);
        await this.access.closeSessions(mikrotik, voucher.code);
      }
    } catch (error) {
      if (!(error instanceof MikrotikNotFoundError)) throw error;
    }
  }

/**
   * Crée les comptes User Manager du lot et leur attribue le profil de
   * l'offre. Les comptes partent en une seule passe : la liste des comptes
   * existants n'est relue qu'une fois, là où un appel unitaire la relirait à
   * chaque ticket.
   *
   * Le code sert de nom d'utilisateur **et** de mot de passe : le client n'a
   * qu'un seul champ à saisir sur le portail captif.
   */

  /**
   * Les lots generes, avec ce qu'ils sont devenus.
   *
   * Les modeles existaient depuis le debut sans qu'aucun ecran ne les montre :
   * on generait cent tickets et plus rien ne disait combien avaient ete
   * vendus, ni quel lot etait deja imprime. La question « ai-je encore des
   * tickets 1 jour ? » se repondait en comptant a la main.
   *
   * Le decompte par statut est fait en base, une requete groupee pour tous
   * les lots : le faire lot par lot multiplierait les allers-retours par le
   * nombre de lots affiches.
   */
  async listBatches() {
    const lots = await this.prisma.scoped.voucherBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        quantity: true,
        prefix: true,
        status: true,
        createdAt: true,
        planches: true,
        plan: { select: { name: true } },
        router: { select: { label: true } },
        createdByAdmin: { select: { email: true } },
        jobs: {
          select: { processed: true, total: true, status: true, errorMessage: true },
          take: 1,
          orderBy: { id: 'desc' },
        },
      },
    });

    if (lots.length === 0) return [];

    const decomptes = await this.prisma.scoped.voucher.groupBy({
      by: ['batchId', 'status'],
      where: { batchId: { in: lots.map((l) => l.id) } },
      _count: { _all: true },
    });

    return lots.map((lot) => {
      const miens = decomptes.filter((d) => d.batchId === lot.id);
      const par = (statut: string) =>
        miens.find((d) => d.status === statut)?._count._all ?? 0;

      const disponibles = par('CREATED');
      const vendus = par('SOLD') + par('ACTIVE') + par('EXPIRED');

      return {
        ...lot,
        job: lot.jobs[0] ?? null,
        jobs: undefined,
        decompte: {
          disponibles,
          vendus,
          expires: par('EXPIRED'),
          coupes: par('DISABLED') + par('CANCELLED'),
          // Rapporte au nombre reellement cree, pas a la quantite demandee :
          // une generation interrompue en a produit moins.
          total: miens.reduce((somme, d) => somme + d._count._all, 0),
        },
      };
    });
  }

  /**
   * Écrit les planches du lot sur le routeur, sans jamais faire échouer la
   * génération.
   *
   * Les tickets existent déjà en base et sur le routeur quand on arrive ici :
   * une clé USB absente ne doit pas annuler une vente à venir. L'échec se lit
   * à l'écran des lots, où la liste des planches reste vide.
   *
   * Contrairement à la génération brute depuis un profil, le lot connaît le
   * **prix** : il est imprimé sur le ticket.
   */
  private async déposerPlanches(
    tickets: Voucher[],
    plan: { name: string; price: unknown; validityDurationSeconds: number },
    routerId: string,
  ): Promise<RapportPlanches> {
    const vide: RapportPlanches = { planches: [], échecs: [], emplacement: '' };
    if (tickets.length === 0) return vide;

    try {
      const mikrotik = await this.clients.forRouter(routerId);
      const tenant = await this.prisma.tenant.findUniqueOrThrow({
        where: { id: this.tenantContext.requireTenantId() },
        select: { wifiName: true, domains: true, currency: true },
      });
      const modèles = await this.modèles.findAll();
      const parPage = modèles.find((m) => m.isDefault)?.perPage ?? modèles[0]?.perPage ?? 30;
      const money = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: tenant.currency,
        maximumFractionDigits: 0,
      });

      const horodatage = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '');
      const étiquette = `${plan.name}-${horodatage}`.replace(/[^A-Za-z0-9_.-]/g, '_');

      return await this.planches.écrire(mikrotik, {
        tickets: tickets.map((t) => ({
          code: t.code,
          offre: plan.name,
          prix: money.format(Number(t.price)),
        })),
        validitéSecondes: plan.validityDurationSeconds,
        réseau: tenant.wifiName,
        domaines: tenant.domains,
        parPage,
        étiquette,
      });
    } catch (error) {
      this.logger.warn(`Planches du lot non produites : ${String(error)}`);
      return vide;
    }
  }

  private async provisionOnUserManager(
    vouchers: Voucher[],
    plan: { id: string; name: string },
    routerId: string,
  ): Promise<Voucher[]> {
    const { profileName } = await this.provisioning.reconcile(plan.id, routerId);
    const mikrotik = await this.clients.forRouter(routerId);
    const tenantId = this.tenantContext.requireTenantId();

    await mikrotik.createUserManagerUsers(
      vouchers.map((voucher) => ({
        username: voucher.code,
        // Le code des deux côtés sur un ticket imprimé : le client n'a
        // qu'une chose à recopier. Sur un achat en ligne, `accessPassword`
        // porte la référence du transfert, que le client connaît déjà.
        password: voucher.accessPassword ?? voucher.code,
        comment: `gemikrot:t:${tenantId.slice(0, 8)}:v:${voucher.code}`,
      })),
    );

    const updated: Voucher[] = [];
    for (const voucher of vouchers) {
      const assignment = await mikrotik.assignProfile({
        username: voucher.code,
        profileName,
      });
      updated.push(
        await this.prisma.scoped.voucher.update({
          where: { id: voucher.id },
          data: {
            umUsername: voucher.code,
            umState: assignment.state,
            // Posé ici aussi, et pas seulement côté HotSpot : une colonne à
            // moitié remplie se lit mal, et `target IS NULL` doit garder son
            // sens unique — « ticket historique, sans compte avant la vente ».
            target: VoucherTarget.USER_MANAGER,
            lastReconciledAt: new Date(),
          },
        }),
      );
    }
    return updated;
  }

  /**
   * Provisionne un lot sur la table HotSpot du routeur.
   *
   * Deux différences de fond avec User Manager, et elles changent le produit
   * vendu.
   *
   * La première : **il n'y a pas de validité calendaire**. Le plafond posé
   * ici est `limit-uptime`, du temps passé connecté — il s'arrête quand le
   * client se déconnecte. Un forfait d'un mois y devient 720 h de connexion,
   * bien plus généreux. L'interface l'écrit avant de générer, en chiffres.
   *
   * La seconde : le compte existe **dès la génération**, là où un ticket
   * historique n'en avait aucun avant sa vente. C'est pourquoi `target` est
   * enregistré : sans lui, `um_username IS NULL` voudrait dire deux choses,
   * et la vente tenterait de créer un compte déjà présent.
   */
  private async provisionOnHotspot(
    vouchers: Voucher[],
    plan: { id: string; name: string; mikrotikProfileName: string; validityDurationSeconds: number },
    routerId: string,
  ): Promise<Voucher[]> {
    const mikrotik = await this.clients.forRouter(routerId);
    const tenantId = this.tenantContext.requireTenantId();
    const updated: Voucher[] = [];

    for (const voucher of vouchers) {
      await mikrotik.createHotspotUser({
        username: voucher.code,
        password: voucher.code,
        profileName: plan.mikrotikProfileName,
        comment: `gemikrot:t:${tenantId.slice(0, 8)}:v:${voucher.code}`,
        // Le seul plafond qui borne réellement un ticket HotSpot : le
        // `session-timeout` du profil, lui, repart à zéro à chaque
        // reconnexion. C'est ce que portent déjà 400 comptes du parc.
        limitUptimeSeconds: plan.validityDurationSeconds,
      });
      updated.push(
        await this.prisma.scoped.voucher.update({
          where: { id: voucher.id },
          data: { target: VoucherTarget.HOTSPOT, lastReconciledAt: new Date() },
        }),
      );
    }
    return updated;
  }

  private async getActivePlan(planId: string) {
    const plan = await this.prisma.scoped.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Plan ${planId} introuvable`);
    if (plan.status !== 'ACTIVE') throw new ConflictException(`Plan ${plan.name} n'est plus actif`);
    return plan;
  }

  private async getDefaultRouterId(): Promise<string> {
    const router = await this.prisma.scoped.router.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!router) {
      throw new ConflictException(
        'Aucun routeur enregistré en base — renseigner routerId ou exécuter le seed',
      );
    }
    return router.id;
  }

  private async createVoucherWithUniqueCode(input: {
    planId: string;
    price: Prisma.Decimal | number;
    batchId?: string;
    prefix?: string;
  }): Promise<Voucher> {
    for (let attempt = 0; attempt < MAX_CODE_COLLISION_RETRIES; attempt += 1) {
      const code = generateVoucherCode(10, input.prefix);
      try {
        return await this.prisma.scoped.voucher.create({
          data: {
            tenantId: this.tenantContext.requireTenantId(),
            code,
            planId: input.planId,
            price: input.price,
            batchId: input.batchId,
          },
        });
      } catch (error) {
        const isUniqueCollision =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!isUniqueCollision) throw error;
      }
    }
    throw new ConflictException('Impossible de générer un code voucher unique après plusieurs essais');
  }
}
