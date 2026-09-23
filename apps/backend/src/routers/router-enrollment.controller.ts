import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Public } from '../auth/public.decorator.js';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { RateLimitGuard } from '../public/rate-limit.guard.js';
import { RouterEnrollmentService } from './router-enrollment.service.js';
import { RaccordementAssisteService } from './raccordement-assiste.service.js';

const CAN_CONFIGURE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN];

export class InviteRouterDto {
  @IsString()
  @Length(2, 60)
  label!: string;
}

/**
 * Les identifiants Winbox, employes une fois puis oublies.
 *
 * Ce corps de requete porte le mot de passe administrateur du routeur. Il ne
 * doit apparaitre nulle part ailleurs : ni en base, ni au journal, ni dans une
 * reponse. Le service qui le recoit le tient dans une variable locale le temps
 * de trois ecritures, et c'est tout.
 */
export class RaccordementAssisteDto {
  @IsString()
  @Length(3, 120)
  host!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsString()
  @Length(1, 60)
  username!: string;

  @IsString()
  @Length(1, 200)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  label?: string;
}

export class EnrollRouterDto {
  @IsString()
  @Length(40, 64)
  publicKey!: string;

  /** Le nom que porte le routeur (`/system identity`), s'il en a un. */
  @IsOptional()
  @IsString()
  @Length(1, 60)
  identity?: string;
}

@Controller('router-enrollments')
export class RouterEnrollmentController {
  constructor(
    private readonly enrollment: RouterEnrollmentService,
    private readonly assiste: RaccordementAssisteService,
  ) {}

  /**
   * Regarde le routeur sans rien y ecrire.
   *
   * Separe du raccordement a dessein : on montre a l'exploitant ce qu'on a
   * trouve — nom, modele, version — et il confirme. Poser un tunnel sur un
   * routeur qu'on n'a pas identifie laisserait une configuration a moitie
   * ecrite que personne ne saurait retrouver.
   */
  @Roles(...CAN_CONFIGURE)
  @Post('sonder')
  sonder(@Body() body: RaccordementAssisteDto) {
    return this.assiste.sonder(body);
  }

  /**
   * Pose le tunnel et le compte dedie, puis enregistre le routeur.
   *
   * Le mot de passe administrateur passe ici et ne va pas plus loin.
   */
  @Roles(...CAN_CONFIGURE)
  @Post('assiste')
  raccorder(@Body() body: RaccordementAssisteDto) {
    return this.assiste.raccorder(body);
  }

  /**
   * Rappel du routeur après exécution du script. **Sans jeton d'application**,
   * parce qu'un routeur n'a pas de session : le jeton d'enrôlement, à usage
   * unique et valable trente minutes, fait seul l'authentification.
   *
   * La limitation de débit porte sur l'adresse d'origine et non sur le jeton :
   * un jeton juste ne sert qu'une fois, c'est le tâtonnement qu'il faut
   * ralentir. Deviner reste hors d'atteinte — 256 bits d'aléa — mais une
   * barrière coûte moins cher que la certitude.
   */
  @Public()
  @UseGuards(
    new RateLimitGuard([
      {
        key: (req) => req.ip ?? 'inconnu',
        limit: 10,
        windowMs: 10 * 60 * 1000,
        message: "Trop de tentatives d'enrôlement depuis cette adresse.",
      },
    ]),
  )
  @Post('callback/:token')
  enroll(@Param('token') token: string, @Body() body: EnrollRouterDto) {
    return this.enrollment.consume(token, body);
  }

  @Roles(...CAN_CONFIGURE)
  @Post()
  invite(@Body() body: InviteRouterDto) {
    return this.enrollment.invite(body.label);
  }

  /**
   * L'etat du serveur de tunnel.
   *
   * Declare avant `@Get()` n'a pas d'importance ici, les chemins different.
   * Ce qui importe, c'est qu'il existe : sans lui, un exploitant dont le
   * serveur n'ecoute pas voit un routeur qui appelle dans le vide et n'a
   * aucun moyen de l'apprendre.
   */
  @Roles(...CAN_CONFIGURE)
  @Get('serveur')
  etatDuServeur() {
    return this.enrollment.etatDuServeur();
  }

  @Roles(...CAN_CONFIGURE)
  @Get()
  pending() {
    return this.enrollment.pending();
  }

  /** Retire une invitation qu'on ne compte plus servir. */
  @Roles(...CAN_CONFIGURE)
  @Delete(':id')
  cancel(@Param('id') id: string) {
    return this.enrollment.cancel(id);
  }
}
