import { api } from './client';

export interface TicketTemplate {
  id: string;
  name: string;
  html: string;
  /** Tickets par page A4 : 30 donne une cellule de 64,6 × 28,1 mm. */
  perPage: number;
  isDefault: boolean;
}

export interface PlaceholderHelp {
  name: string;
  description: string;
}

export interface RenderedSheet {
  html: string;
  unknownPlaceholders: string[];
}

export const ticketTemplatesApi = {
  list: () => api.get<TicketTemplate[]>('/ticket-templates'),
  placeholders: () => api.get<PlaceholderHelp[]>('/ticket-templates/placeholders'),
  create: (input: { name: string; html: string; perPage: number }) =>
    api.post<TicketTemplate>('/ticket-templates', input),
  update: (id: string, input: { name?: string; html?: string; perPage?: number }) =>
    api.patch<TicketTemplate>(`/ticket-templates/${id}`, input),
  remove: (id: string) => api.delete<void>(`/ticket-templates/${id}`),
  preview: (html: string, perPage: number) =>
    api.post<RenderedSheet>('/ticket-templates/preview', { html, perPage }),
  render: (input: { templateId: string; batchId?: string; voucherIds?: string[] }) =>
    api.post<RenderedSheet>('/ticket-templates/render', input),
};
