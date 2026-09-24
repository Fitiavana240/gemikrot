import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Public } from '../auth/public.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { HealthService } from './health.service.js';

/**
 * Le point de santé, et son détail.
 *
 * **Le code HTTP porte le verdict, pas seulement le corps.** Un moniteur
 * lit d'abord le statut de la réponse ; rendre `200 { statut: "degrade" }`
 * ferait passer une base tombée pour un serveur en forme, et la surveillance
 * resterait verte pendant la panne qu'elle existe pour voir.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Ouvert : un moniteur n'a pas de session.
   *
   * Il ne rend donc rien qui renseigne sur l'installation — ni nom de
   * migration, ni décompte de routeurs. Seulement : ça répond, ou non.
   */
  @Public()
  @Get()
  async resume() {
    const sante = await this.health.resume();
    if (sante.statut !== 'ok') throw new ServiceUnavailableException(sante);
    return sante;
  }

  /** Le détail, pour qui administre la plateforme. */
  @Roles(AdminRole.SUPER_ADMIN)
  @Get('detail')
  detail() {
    return this.health.detail();
  }
}
