import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AdminRole, Prisma } from '@prisma/client';
import type { CreatePppSecretDto, UpdatePppSecretDto } from '@wifitati/mikrotik-service';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { Roles } from '../auth/roles.decorator.js';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';

/**
 * PPPoE : l'autre façon de vendre de l'accès.
 *
 * Là où le HotSpot authentifie un navigateur derrière un portail, PPPoE
 * authentifie la connexion elle-même — c'est ce qu'on pose chez un abonné
 * raccordé à demeure, qui n'a pas à ouvrir une page pour être en ligne.
 *
 * **Une réserve à connaître.** Quatre des cinq tables ont été relevées sur le
 * matériel (`scripts/probe-ppp-sonde.ts`, charges figées dans
 * `tests/mappers/ppp.spec.ts`). La cinquième, les sessions actives, ne l'a
 * jamais été : le parc n'a aucun PPPoE en service, donc `/ppp/active` était
 * vide au relevé. Ses noms de champs viennent de la documentation seule, et
 * l'écran le dit plutôt que de laisser croire.
 */
@Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
@Controller('routers/:routerId/ppp')
export class PppController {
  constructor(
    private readonly clients: MikrotikClientFactory,
    private readonly audit: AuditService,
  ) {}

  /** Comptes PPPoE : un par abonné raccordé. */
  @Get('secrets')
  async secrets(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getPppSecrets();
  }

  /** Profils : c'est là que vit le débit, comme les offres du HotSpot. */
  @Get('profiles')
  async profiles(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getPppProfiles();
  }

  /** Sessions en cours. **Noms de champs non vérifiés sur matériel.** */
  @Get('active')
  async active(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getPppActive();
  }

  @Get('servers')
  async servers(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getPppoeServers();
  }

  /** Bassins d'adresses. Un profil y puise l'adresse qu'il donne à l'abonné. */
  @Get('pools')
  async pools(@Param('routerId') routerId: string) {
    return (await this.clients.forRouter(routerId)).getIpPools();
  }

  // ---------- Écriture ----------

  @Post('secrets')
  async create(
    @Param('routerId') routerId: string,
    @Body() dto: CreatePppSecretDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const compte = await (await this.clients.forRouter(routerId)).createPppSecret(dto);
    await this.journaliser(routerId, user.id, 'CREATE_PPP_SECRET', dto.username, {
      profile: dto.profile ?? null,
      service: dto.service ?? 'pppoe',
    });
    return compte;
  }

  @Patch('secrets/:username')
  async update(
    @Param('routerId') routerId: string,
    @Param('username') username: string,
    @Body() dto: UpdatePppSecretDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const compte = await (await this.clients.forRouter(routerId)).updatePppSecret(username, dto);
    // Les champs touchés, jamais leurs valeurs : le mot de passe passe par
    // ici et n'a rien à faire dans un journal que d'autres consultent.
    await this.journaliser(routerId, user.id, 'UPDATE_PPP_SECRET', username, {
      champs: Object.keys(dto),
    });
    return compte;
  }

  /**
   * Suspendre ou réactiver.
   *
   * Ne coupe pas la session en cours : PPPoE ne revérifie l'authentification
   * qu'à la reconnexion. Pour couper tout de suite, fermer aussi la session.
   */
  @Patch('secrets/:username/disabled')
  async setDisabled(
    @Param('routerId') routerId: string,
    @Param('username') username: string,
    @Body() body: { disabled: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const compte = await (
      await this.clients.forRouter(routerId)
    ).setPppSecretDisabled(username, body.disabled);
    await this.journaliser(
      routerId,
      user.id,
      body.disabled ? 'SUSPEND_PPP_SECRET' : 'RESUME_PPP_SECRET',
      username,
      { disabled: body.disabled },
    );
    return compte;
  }

  @Delete('secrets/:username')
  async remove(
    @Param('routerId') routerId: string,
    @Param('username') username: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await (await this.clients.forRouter(routerId)).deletePppSecret(username);
    await this.journaliser(routerId, user.id, 'DELETE_PPP_SECRET', username, {});
  }

  /** Ferme une session sans toucher au compte. */
  @Delete('active/:id')
  async disconnect(
    @Param('routerId') routerId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await (await this.clients.forRouter(routerId)).disconnectPppActive(id);
    await this.journaliser(routerId, user.id, 'DISCONNECT_PPP_SESSION', id, {});
  }

  private journaliser(
    routerId: string,
    adminUserId: string,
    action: string,
    targetId: string,
    payloadDiff: Prisma.InputJsonObject,
  ) {
    return this.audit.log({
      adminUserId,
      routerId,
      action,
      targetType: 'PppSecret',
      targetId,
      payloadDiff,
    });
  }
}
