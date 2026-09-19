import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator.js';
import { TicketTemplatesService } from './ticket-templates.service.js';
import { PLACEHOLDER_HELP } from './ticket-render.service.js';
import {
  CreateTicketTemplateDto,
  PreviewTicketTemplateDto,
  RenderTicketsDto,
  UpdateTicketTemplateDto,
} from './dto/ticket-template.dto.js';

/** Le modèle engage l'image de l'exploitant : réservé à l'exploitant. */
const CAN_EDIT = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN];
/** Imprimer un lot est un geste quotidien de vendeur. */
const CAN_PRINT = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.OPERATOR];

@Controller('ticket-templates')
export class TicketTemplatesController {
  constructor(private readonly templates: TicketTemplatesService) {}

  @Get()
  findAll() {
    return this.templates.findAll();
  }

  /** Les valeurs utilisables dans un modèle, pour l'aide de l'éditeur. */
  @Get('placeholders')
  placeholders() {
    return PLACEHOLDER_HELP;
  }

  @Roles(...CAN_EDIT)
  @Post()
  create(@Body() dto: CreateTicketTemplateDto) {
    return this.templates.create(dto);
  }

  @Roles(...CAN_EDIT)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketTemplateDto) {
    return this.templates.update(id, dto);
  }

  @Roles(...CAN_EDIT)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.templates.remove(id);
  }

  /** Aperçu sans enregistrer, avec des tickets d'exemple. */
  @Roles(...CAN_EDIT)
  @Post('preview')
  preview(@Body() dto: PreviewTicketTemplateDto) {
    return this.templates.preview(dto.html, dto.perPage);
  }

  /** Feuille imprimable pour de vrais tickets. */
  @Roles(...CAN_PRINT)
  @Post('render')
  render(@Body() dto: RenderTicketsDto) {
    return this.templates.renderVouchers(dto.templateId, {
      batchId: dto.batchId,
      voucherIds: dto.voucherIds,
    });
  }
}
