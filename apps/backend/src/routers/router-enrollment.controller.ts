import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length } from 'class-validator';
import { Public } from '../auth/public.decorator.js';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { RateLimitGuard } from '../public/rate-limit.guard.js';
import { RouterEnrollmentService } from './router-enrollment.service.js';

const CAN_CONFIGURE = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN];

export class InviteRouterDto {
  @IsString()
  @Length(2, 60)
  label!: string;
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
  constructor(private readonly enrollment: RouterEnrollmentService) {}

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
