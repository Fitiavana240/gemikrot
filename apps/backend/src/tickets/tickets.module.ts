import { Module } from '@nestjs/common';
import { TicketTemplatesService } from './ticket-templates.service.js';
import { TicketPdfService } from './ticket-pdf.service.js';
import { PlancheRouteurService } from './planche-routeur.service.js';
import { TicketRenderService } from './ticket-render.service.js';
import { TicketTemplatesController } from './tickets.controller.js';

@Module({
  controllers: [TicketTemplatesController],
  providers: [TicketTemplatesService, TicketRenderService, TicketPdfService, PlancheRouteurService],
  exports: [TicketTemplatesService, TicketPdfService, PlancheRouteurService],
})
export class TicketsModule {}
