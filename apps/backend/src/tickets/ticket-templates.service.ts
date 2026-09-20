import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TicketTemplate, VoucherStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import {
  TemplateRejected,
  TicketRenderService,
  type TicketPlaceholders,
} from './ticket-render.service.js';
import { contenuQr, qrDataUri } from './qr.util.js';

/**
 * Gabarit livré d'origine, calibré pour 30 tickets par A4 — une cellule de
 * 64,6 × 28,1 mm, soit le tiers d'une carte de visite. Logo, code, prix et
 * validité y tiennent ; des conditions de vente, non.
 */
const DEFAULT_TEMPLATE = `<div style="text-align:center">
  <img src="{{logoUrl}}" alt="" />
  <div style="font-size:7pt;color:#64748b">{{wifiName}}</div>
  <div style="font-family:monospace;font-size:13pt;font-weight:bold;letter-spacing:1px;margin:1mm 0">{{code}}</div>
  <div style="font-size:7pt">{{planName}} · {{price}}</div>
  <div style="font-size:6pt;color:#94a3b8">valable {{validity}}</div>
</div>`;

/**
 * Second gabarit, 10 par page : de la place pour des mentions — et pour un
 * QR code, que la cellule de 30 tickets ne peut pas accueillir lisiblement.
 *
 * Le QR est à droite du code, pas à sa place : un client dont le téléphone
 * ne scanne pas doit toujours pouvoir saisir les caractères.
 */
const LARGE_TEMPLATE = `<div>
  <table style="width:100%">
    <tr>
      <td><img src="{{logoUrl}}" alt="" /></td>
      <td align="right"><strong>{{wifiName}}</strong></td>
    </tr>
  </table>
  <table style="width:100%">
    <tr>
      <td>
        <div style="font-family:monospace;font-size:16pt;font-weight:bold;letter-spacing:2px;text-align:center;margin:2mm 0">{{code}}</div>
        <div style="text-align:center;font-size:9pt">{{planName}} — {{price}}</div>
        <div style="text-align:center;font-size:8pt;color:#64748b">Valable {{validity}} à partir de la première connexion</div>
      </td>
      <td align="right" style="width:18mm"><img src="{{qrUrl}}" alt="" style="width:16mm;height:16mm" /></td>
    </tr>
  </table>
  <div style="font-size:7pt;color:#94a3b8;margin-top:1mm">Scannez le code, ou connectez-vous au Wi-Fi puis saisissez-le. Ticket {{ticketIndex}}/{{ticketTotal}} — {{createdAt}}</div>
</div>`;

/**
 * Les gabarits livrés d'une version antérieure, et ce qui les remplace.
 *
 * Clé : le HTML exact tel qu'il a été posé à l'époque. Un gabarit trouvé
 * identique n'a jamais été modifié — le remplacer ne perd donc rien.
 */
const ANCIENS_GABARITS: Record<string, string> = {
  // Version d'avant le QR code : même mise en page, sans l'image.
  [`<div>
  <table style="width:100%">
    <tr>
      <td><img src="{{logoUrl}}" alt="" /></td>
      <td align="right"><strong>{{wifiName}}</strong></td>
    </tr>
  </table>
  <div style="font-family:monospace;font-size:16pt;font-weight:bold;letter-spacing:2px;text-align:center;margin:2mm 0">{{code}}</div>
  <div style="text-align:center;font-size:9pt">{{planName}} — {{price}}</div>
  <div style="text-align:center;font-size:8pt;color:#64748b">Valable {{validity}} à partir de la première connexion</div>
  <div style="font-size:7pt;color:#94a3b8;margin-top:1mm">Connectez-vous au Wi-Fi puis saisissez ce code. Ticket {{ticketIndex}}/{{ticketTotal}} — {{createdAt}}</div>
</div>`]: LARGE_TEMPLATE,
};

@Injectable()
export class TicketTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly render: TicketRenderService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Les gabarits d'origine sont créés à la première visite plutôt que par une
   * migration : un exploitant inscrit plus tard les obtient aussi, et une
   * migration n'aurait pas su les lui donner.
   */
  async findAll(): Promise<TicketTemplate[]> {
    const existing = await this.prisma.scopedStrict.ticketTemplate.findMany({
      orderBy: { createdAt: 'asc' },
    });
    if (existing.length > 0) return this.alignerGabaritsIntacts(existing);

    const tenantId = this.tenantContext.requireTenantId();
    await this.prisma.scopedStrict.ticketTemplate.createMany({
      data: [
        { tenantId, name: '30 par page A4', html: DEFAULT_TEMPLATE, perPage: 30, isDefault: true },
        { tenantId, name: 'Grand format, 10 par page', html: LARGE_TEMPLATE, perPage: 10 },
      ],
    });
    return this.prisma.scopedStrict.ticketTemplate.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /**
   * Fait profiter des améliorations du gabarit livré ceux qui ne l'ont jamais
   * touché — l'ajout du QR code, ici.
   *
   * La comparaison est **au caractère près** avec la version précédemment
   * livrée. C'est délibérément strict : dès qu'un exploitant a modifié son
   * gabarit, fût-ce d'un espace, il est à lui et rien ne le réécrit. Le seul
   * cas traité est celui d'un gabarit d'origine resté tel quel, où remplacer
   * ne perd rien et évite qu'une fonctionnalité reste invisible faute d'avoir
   * su qu'il fallait l'ajouter à la main.
   */
  private async alignerGabaritsIntacts(
    gabarits: TicketTemplate[],
  ): Promise<TicketTemplate[]> {
    const àAligner = gabarits.filter((g) => ANCIENS_GABARITS[g.html] !== undefined);
    if (àAligner.length === 0) return gabarits;

    await Promise.all(
      àAligner.map((g) =>
        this.prisma.scopedStrict.ticketTemplate.update({
          where: { id: g.id },
          data: { html: ANCIENS_GABARITS[g.html] },
        }),
      ),
    );
    return this.prisma.scopedStrict.ticketTemplate.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async findOne(id: string): Promise<TicketTemplate> {
    const template = await this.prisma.scopedStrict.ticketTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException(`Modèle ${id} introuvable`);
    return template;
  }

  async create(input: { name: string; html: string; perPage: number }): Promise<TicketTemplate> {
    this.check(input.html);
    return this.prisma.scopedStrict.ticketTemplate.create({
      data: { tenantId: this.tenantContext.requireTenantId(), ...input },
    });
  }

  async update(
    id: string,
    input: { name?: string; html?: string; perPage?: number },
  ): Promise<TicketTemplate> {
    await this.findOne(id);
    if (input.html !== undefined) this.check(input.html);
    return this.prisma.scopedStrict.ticketTemplate.update({ where: { id }, data: input });
  }

  async remove(id: string): Promise<void> {
    const template = await this.findOne(id);
    if (template.isDefault) {
      throw new BadRequestException('Le modèle par défaut ne peut pas être supprimé');
    }
    await this.prisma.scopedStrict.ticketTemplate.delete({ where: { id } });
  }

  /** Aperçu sans enregistrer : l'admin voit son modèle avant de le garder. */
  preview(html: string, perPage: number) {
    this.check(html);
    const sample: TicketPlaceholders[] = Array.from({ length: Math.min(perPage, 30) }, (_, i) => ({
      code: `EXEMPLE${String(i + 1).padStart(2, '0')}`,
      planName: '1Jour-2000Ar',
      price: '2 000 MGA',
      currency: 'MGA',
      validity: '1 j',
      wifiName: 'Zone WIFI-TATI',
      logoUrl: '',
      createdAt: new Date().toLocaleDateString('fr-FR'),
      ticketIndex: String(i + 1),
      ticketTotal: String(perPage),
      // L'aperçu porte un vrai QR : un carré gris ne dirait pas si le
      // motif tient dans la cellule, ce qui est justement la question.
      qrUrl: qrDataUri(`EXEMPLE${String(i + 1).padStart(2, '0')}`),
    }));
    return this.render.renderSheet(html, sample, { perPage, title: 'Aperçu' });
  }

  /**
   * Feuille imprimable pour des tickets réels. Seuls les tickets encore à
   * vendre sont imprimés par défaut : réimprimer un ticket déjà vendu le
   * mettrait en circulation deux fois.
   */
  async renderVouchers(templateId: string, filter: { batchId?: string; voucherIds?: string[] }) {
    const template = await this.findOne(templateId);

    const vouchers = await this.prisma.scopedStrict.voucher.findMany({
      where: {
        ...(filter.batchId ? { batchId: filter.batchId } : {}),
        ...(filter.voucherIds?.length ? { id: { in: filter.voucherIds } } : {}),
        ...(filter.voucherIds?.length ? {} : { status: VoucherStatus.CREATED }),
      },
      include: { plan: { select: { name: true, validityDurationSeconds: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (vouchers.length === 0) {
      throw new NotFoundException('Aucun ticket à imprimer pour cette sélection');
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: this.tenantContext.requireTenantId() },
      select: { wifiName: true, logoUrl: true, currency: true, domains: true },
    });
    const money = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: tenant.currency,
      maximumFractionDigits: 0,
    });

    const placeholders: TicketPlaceholders[] = vouchers.map((voucher, index) => ({
      code: voucher.code,
      planName: voucher.plan.name,
      price: money.format(Number(voucher.price)),
      currency: tenant.currency,
      validity: humanDuration(voucher.plan.validityDurationSeconds),
      wifiName: tenant.wifiName,
      logoUrl: tenant.logoUrl ?? '',
      createdAt: voucher.createdAt.toLocaleDateString('fr-FR'),
      ticketIndex: String(index + 1),
      ticketTotal: String(vouchers.length),
      qrUrl: qrDataUri(contenuQr(voucher.code, tenant.domains)),
    }));

    return this.render.renderSheet(template.html, placeholders, {
      perPage: template.perPage,
      title: `Tickets ${tenant.wifiName}`,
    });
  }

  /** Traduit le refus en erreur HTTP lisible pour l'admin. */
  private check(html: string): void {
    try {
      this.render.assertSafe(html);
    } catch (error) {
      if (error instanceof TemplateRejected) {
        throw new BadRequestException(
          `Modèle refusé — retirez ${error.reasons.join(', ')}. Seule la mise en forme est acceptée.`,
        );
      }
      throw error;
    }
  }
}

function humanDuration(seconds: number): string {
  if (seconds >= 86_400) {
    const days = seconds / 86_400;
    return `${Number.isInteger(days) ? days : days.toFixed(1)} j`;
  }
  if (seconds >= 3600) {
    const hours = seconds / 3600;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  }
  return `${Math.round(seconds / 60)} min`;
}
