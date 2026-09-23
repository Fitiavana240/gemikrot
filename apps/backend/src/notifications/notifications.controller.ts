import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Ce qui demande une décision, pour l'administrateur connecté.
 *
 * Aucun `@Roles` : un lecteur seul a autant besoin de savoir qu'un client
 * attend son code depuis trois jours. Il ne pourra rien valider, mais il
 * pourra le dire à quelqu'un — et c'est déjà beaucoup mieux que de
 * l'ignorer.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  lister(@CurrentUser() user: AuthenticatedUser) {
    // Le role est transmis : sans lui, le SUPER_ADMIN retombe sur la branche
    // << pas d'exploitant >>, qui ne rendait rien.
    return this.notifications.lister(user.id, user.role);
  }

  /** « J'ai vu. » Écarté pour cet administrateur, pas pour les autres. */
  @Post('lue')
  async marquerLue(@CurrentUser() user: AuthenticatedUser, @Body() body: { cle: string }) {
    await this.notifications.marquerLue(user.id, body.cle);
    return { ok: true };
  }
}
