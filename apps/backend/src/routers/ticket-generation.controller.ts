import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { Roles } from '../auth/roles.decorator.js';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';
import { TicketGenerationService, type CibleGeneration } from './ticket-generation.service.js';

export class GenerationDemandeDto {
  @IsIn(['user-manager', 'hotspot'])
  cible!: CibleGeneration;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  profileName!: string;

  @IsInt()
  @Min(1)
  @Max(200)
  quantite!: number;

  /** Préfixe lisible, pour reconnaître le lot sur le routeur. */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  prefixe?: string;

  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(16)
  longueurCode?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  commentaire?: string;
}

/**
 * Génération directe de tickets depuis un profil du routeur.
 *
 * L'équivalent du « Generate Voucher » de WinBox, pour le cas que les lots
 * de l'écran Tickets ne couvrent pas : un profil présent sur le routeur sans
 * offre correspondante dans l'application.
 */
@Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
@Controller('routers/:routerId/tickets')
export class TicketGenerationController {
  constructor(
    private readonly generation: TicketGenerationService,
    private readonly clients: MikrotikClientFactory,
  ) {}

  /**
   * Les cibles réellement disponibles sur ce routeur, avec leurs profils.
   *
   * L'interface ne doit pas proposer User Manager sur un routeur qui ne
   * l'a pas installé : la génération échouerait après coup, alors que
   * l'absence se constate avant.
   */
  @Get('targets')
  async targets(@Param('routerId') routerId: string) {
    const mikrotik = await this.clients.forRouter(routerId);

    // User Manager est un paquet optionnel : son absence n'est pas une
    // panne, c'est un état à rapporter.
    const um = await mikrotik
      .getUserManagerProfiles()
      .then((profils) => profils.map((p) => p.name))
      .catch(() => null);

    const hotspot = await mikrotik
      .getHotspotProfiles()
      .then((profils) => profils.map((p) => p.name))
      .catch(() => null);

    return {
      userManager: { disponible: um !== null, profils: um ?? [] },
      hotspot: { disponible: hotspot !== null, profils: hotspot ?? [] },
    };
  }

  @Post('generate')
  generate(
    @Param('routerId') routerId: string,
    @Body() dto: GenerationDemandeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.generation.generer(routerId, dto, user.id);
  }
}
