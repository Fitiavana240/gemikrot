import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AdminRole, TenantStatus } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { TenantsService } from './tenants.service.js';
import { MiseEnRouteService } from './mise-en-route.service.js';
import { AbonnementPlateformeService } from './abonnement-plateforme.service.js';
import { SupervisionService } from './supervision.service.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import { MobileMoneyAccountDto } from './dto/mobile-money-account.dto.js';

@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly miseEnRoute: MiseEnRouteService,
    private readonly abonnement: AbonnementPlateformeService,
    private readonly superviser: SupervisionService,
  ) {}

  /**
   * SAS-2 : l'abonnement a la plateforme, vu par l'exploitant lui-meme.
   *
   * Lisible par tous ses comptes : savoir que l'echeance approche n'est pas
   * une information d'administrateur, c'est ce qui evite de decouvrir la
   * vente fermee un matin.
   */
  @Get('me/abonnement')
  monAbonnement() {
    return this.abonnement.etatDeLExploitantCourant();
  }

  /**
   * Le catalogue des offres de la plateforme.
   *
   * Lisible de tout compte connecte : c'est ce qu'affiche la page de blocage,
   * et celui qui la lit est justement celui dont l'abonnement a expire.
   * Declare avant `:id`, sinon Nest lirait << offres >> comme un identifiant.
   */
  @Get('offres')
  offres() {
    return this.abonnement.offres();
  }

  /** Reserve au SUPER_ADMIN : souscrit ou renouvelle, echeance calculee. */
  @Roles(AdminRole.SUPER_ADMIN)
  @Post(':id/abonnement/souscrire')
  souscrire(
    @Param('id') id: string,
    @Body() body: { code: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.abonnement.souscrire(id, body.code, user.id);
  }

  /** Reserve au SUPER_ADMIN : pose l'offre, le plafond et l'echeance. */
  @Roles(AdminRole.SUPER_ADMIN)
  @Patch(':id/abonnement')
  definirAbonnement(
    @Param('id') id: string,
    @Body()
    dto: { platformPlanName?: string | null; maxRouters?: number | null; platformEndsAt?: string | null },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.abonnement.definir(id, dto, user.id);
  }

  /** Paramètres de l'exploitant connecté (marque, devise, puces Mobile Money). */
  @Get('me')
  findMine() {
    return this.tenants.findMine();
  }

  /**
   * SAS-3 : les quatre pas qui separent un compte neuf d'une premiere vente.
   *
   * Chaque etape est constatee, jamais declaree : « routeur connecte » se
   * coche parce que le routeur a repondu, pas parce qu'une ligne existe.
   */
  @Get('me/mise-en-route')
  miseEnRouteDeLExploitant() {
    return this.miseEnRoute.etat();
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Patch('me')
  updateMine(@Body() dto: UpdateTenantDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.update(dto, user.id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Post('me/mobile-money')
  addMobileMoney(@Body() dto: MobileMoneyAccountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.addMobileMoneyAccount(dto, user.id);
  }

  /** Retirer une puce du choix propose au client, sans effacer son historique. */
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Patch('me/mobile-money/:id/active')
  setMobileMoneyActive(
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenants.setMobileMoneyActive(id, body.isActive, user.id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Delete('me/mobile-money/:id')
  removeMobileMoney(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.removeMobileMoneyAccount(id, user.id);
  }

  // ---------- Réservé à l'exploitant de la plateforme ----------

  @Roles(AdminRole.SUPER_ADMIN)
  @Get()
  findAll() {
    return this.tenants.findAll();
  }

  /**
   * SAS-4 : la plateforme vue d'en haut.
   *
   * Declaree **avant** `:id`, sinon Nest lirait << supervision >> comme un
   * identifiant d'exploitant et rendrait un 404 qui ne dirait rien.
   */
  @Roles(AdminRole.SUPER_ADMIN)
  @Get('supervision')
  supervision() {
    return this.superviser.apercu();
  }

  /**
   * Active le compte, et ouvre l'essai gratuit du même geste.
   *
   * L'essai part **ici** et non à l'inscription : tant que le compte n'est pas
   * actif, sa connexion est refusée. Un compte inscrit le lundi et activé le
   * jeudi aurait brûlé trois de ses cinq jours sans avoir vu la console une
   * seule fois.
   */
  @Roles(AdminRole.SUPER_ADMIN)
  @Post(':id/activate')
  async activate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const tenant = await this.tenants.setStatus(id, TenantStatus.ACTIVE, user.id);
    // Ne fait rien si une échéance existe déjà : réactiver un compte suspendu
    // ne rouvre pas un essai.
    await this.abonnement.demarrerEssai(id, user.id);
    return tenant;
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post(':id/suspend')
  suspend(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.setStatus(id, TenantStatus.SUSPENDED, user.id);
  }
}
