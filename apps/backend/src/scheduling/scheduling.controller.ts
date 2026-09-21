import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { ExpiryJobService } from './expiry-job.service.js';

/**
 * Ce que feraient les travaux de fond, et s'ils tournent.
 *
 * Lecture seule, entièrement. Allumer l'ordonnanceur reste une décision
 * d'exploitant qui se prend dans la configuration du serveur : la console
 * l'expose pour qu'on la prenne en connaissance de cause, elle ne la prend
 * pas à sa place.
 */
@Controller('scheduling')
export class SchedulingController {
  constructor(
    private readonly expiry: ExpiryJobService,
    private readonly config: ConfigService,
  ) {}

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @Get('apercu')
  async apercu() {
    const aperçu = await this.expiry.apercu();
    return {
      // Même expression que `SchedulerService` : un écart ferait dire à la
      // console l'inverse de ce que fait le serveur.
      actif: this.config.get<string>('SCHEDULER_ENABLED') === 'true',
      ...aperçu,
    };
  }
}
