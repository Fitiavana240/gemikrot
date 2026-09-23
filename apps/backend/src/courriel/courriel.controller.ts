import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import {
  CourrielService,
  type ReglagesCourriel,
  type ReglagesPlateforme,
} from './courriel.service.js';

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

  // ---------- La plateforme, reservee au SUPER_ADMIN ----------
  //
  // Un serveur d'envoi a elle : le SUPER_ADMIN n'appartient a aucun
  // exploitant et n'avait donc nulle part ou ranger le sien. Les avis
  // d'inscription et les codes de confirmation partaient du SMTP du nouvel
  // inscrit -- qui n'en a aucun a la seconde ou il s'inscrit -- donc ils ne
  // partaient jamais.

  @Roles(AdminRole.SUPER_ADMIN)
  @Get('plateforme')
  reglagesPlateforme() {
    return this.courriel.reglagesPlateforme();
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Patch('plateforme')
  enregistrerPlateforme(
    @Body() body: Partial<ReglagesPlateforme> & { motDePasse?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.courriel.enregistrerPlateforme(body, user.id);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Get('plateforme/journal')
  journalPlateforme() {
    return this.courriel.journalPlateforme();
  }

  /** Un essai depuis le serveur de la plateforme, vers l'adresse indiquee. */
  @Roles(AdminRole.SUPER_ADMIN)
  @Post('plateforme/essai')
  essaiPlateforme(@Body() body: { destinataire: string }) {
    return this.courriel.envoyerDeLaPlateforme({
      destinataire: body.destinataire,
      sujet: 'Essai d’envoi — plateforme GeMikrot',
      texte: [
        "Ce message confirme que le serveur d'envoi de la plateforme est correctement réglé.",
        '',
        'Si vous le lisez, les codes de confirmation et les avis d’inscription pourront partir.',
        '',
        '— GeMikrot',
      ].join('\n'),
      type: 'essai-plateforme',
    });
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
