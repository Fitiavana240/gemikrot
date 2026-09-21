import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { CourrielService, type ReglagesCourriel } from './courriel.service.js';

/**
 * Le reglage du courriel, et le journal de ce qui est parti.
 *
 * L'essai est le seul envoi que l'exploitant declenche a la main, et il va
 * ou il veut : c'est son geste, vers son adresse, pour verifier ses
 * identifiants avant qu'un client ne depende d'eux.
 */
@Controller('courriel')
export class CourrielController {
  constructor(private readonly courriel: CourrielService) {}

  @Get()
  reglages() {
    return this.courriel.reglages();
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Patch()
  enregistrer(
    @Body() body: Partial<ReglagesCourriel> & { motDePasse?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.courriel.enregistrer(body, user.id);
  }

  /** Les cinquante derniers envois, reussis comme echoues. */
  @Get('journal')
  journal() {
    return this.courriel.journal();
  }

  /**
   * Un envoi d'essai, vers l'adresse que l'exploitant indique.
   *
   * Sans lui, la premiere preuve que le SMTP marche serait un client qui ne
   * recoit pas son code -- et personne ne saurait que c'est la cause.
   */
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Post('essai')
  essai(@Body() body: { destinataire: string }) {
    return this.courriel.envoyer({
      destinataire: body.destinataire,
      sujet: 'Essai d’envoi — GeMikrot',
      texte:
        "Ce message confirme que votre serveur d'envoi est correctement réglé.\n\n" +
        "Si vous le lisez, vos clients et vos administrateurs pourront être prévenus par courriel.\n\n" +
        '— GeMikrot',
      type: 'essai',
    });
  }
}
