import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { RoutersService } from './routers.service.js';
import { RouterImportService } from './router-import.service.js';
import { RouterOperationQueue } from './router-operation.service.js';
import { CreateRouterDto, ProbeFingerprintDto, UpdateRouterDto } from './dto/create-router.dto.js';

/** La configuration des routeurs est réservée aux administrateurs. */
const CAN_CONFIGURE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN];

@Controller('routers')
export class RoutersController {
  constructor(
    private readonly routersService: RoutersService,
    private readonly importService: RouterImportService,
    private readonly operations: RouterOperationQueue,
  ) {}

  @Get()
  findAll() {
    return this.routersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.routersService.findOne(id);
  }

  /** Ce qui attend d'être réécrit sur le routeur, et pourquoi. */
  @Get('operations/pending')
  pendingOperations(@Query('routerId') routerId?: string) {
    return this.operations.pending(routerId);
  }

  /** Rejoue la file sans attendre le prochain retour du routeur. */
  @Roles(...CAN_CONFIGURE)
  @Post(':id/operations/drain')
  drainOperations(@Param('id') id: string) {
    return this.operations.drain(id);
  }

  @Get(':id/test-connection')
  testConnection(@Param('id') id: string) {
    return this.routersService.testConnection(id);
  }

  @Roles(...CAN_CONFIGURE)
  @Post()
  create(@Body() dto: CreateRouterDto, @CurrentUser() user: AuthenticatedUser) {
    return this.routersService.create(dto, user.id);
  }

  /**
   * Retire un routeur de la console. **Reserve au SUPER_ADMIN.**
   *
   * Ce n'est pas une mesure de defiance envers l'exploitant : c'est un geste
   * irreversible sur du materiel en production, et la personne qui gere la
   * plateforme est celle qui peut en mesurer la portee. Un essai de
   * raccordement qui n'aboutit pas laisse une fiche a nettoyer, et ce menage
   * ne doit pas pouvoir emporter un routeur qui sert des clients.
   *
   * La suppression ne touche pas au routeur lui-meme : elle efface la fiche,
   * pas la configuration posee dessus.
   */
  @Roles(AdminRole.SUPER_ADMIN)
  @Delete(':id')
  supprimer(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.routersService.supprimer(id, user.id);
  }

  @Roles(...CAN_CONFIGURE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRouterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.routersService.update(id, dto, user.id);
  }

  @Roles(...CAN_CONFIGURE)
  @Post('probe-fingerprint')
  probeFingerprint(@Body() dto: ProbeFingerprintDto) {
    return this.routersService.probeFingerprint(dto.host, dto.port);
  }

  /**
   * Recopie l'état du routeur en base (profils, comptes, contournements).
   * `?dryRun=true` montre ce qui serait importé sans rien écrire.
   */
  @Roles(...CAN_CONFIGURE)
  @Post(':id/import')
  import(
    @Param('id') id: string,
    @Query('dryRun') dryRun: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importService.importFromRouter(id, {
      dryRun: dryRun === 'true',
      adminUserId: user.id,
    });
  }
}
