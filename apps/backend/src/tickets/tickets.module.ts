import { Module } from '@nestjs/common';
import { TicketTemplatesService } from './ticket-templates.service.js';
import { TicketRenderService } from './ticket-render.service.js';
import { TicketTemplatesController } from './tickets.controller.js';

@Module({
  controllers: [TicketTemplatesController],
  providers: [TicketTemplatesService, TicketRenderService],
  exports: [TicketTemplatesService],
})
export class TicketsModule {}
