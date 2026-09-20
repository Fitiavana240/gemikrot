import { Controller, Get, Query } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { AuditService } from './audit.service.js';

/** Le journal dit qui a fait quoi : le lire n'appartient pas à qui vend. */
const CAN_READ_AUDIT = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN];

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * Le journal, filtrable.
   *
   * Il était écrit depuis le début et n'avait jamais été relu : un audit que
   * personne ne consulte ne protège de rien, il coûte seulement de l'écriture.
   */
  @Roles(...CAN_READ_AUDIT)
  @Get()
  list(
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('adminUserId') adminUserId?: string,
    @Query('result') result?: string,
    @Query('since') since?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.list({
      action,
      targetType,
      adminUserId,
      result,
      since,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** Les valeurs réellement présentes, pour peupler les filtres sans les deviner. */
  @Roles(...CAN_READ_AUDIT)
  @Get('facets')
  facets() {
    return this.audit.facets();
  }
}
