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
 * Le gabarit par défaut, repris de la planche que ce parc imprime déjà.
 *
 * Il n'a pas été inventé : il reproduit celle qui tourne depuis des mois, et
 * qui a donc fait ses preuves au comptoir — bande de prix verticale sur la
 * gauche, identifiants en grand au centre, QR à droite, coordonnées en pied.
 * Un vendeur qui trie des tickets les prend par la tranche : c'est la bande
 * colorée qui lui dit le prix sans lire, et c'est pour cela qu'elle est là.
 *
 * **Tout ce qui distingue un exploitant d'un autre est un marqueur.** Le nom
 * du réseau, le logo, le prix, la durée, le site, les numéros, la page
 * Facebook : rien n'est écrit en dur. Le même gabarit sert le voisin sans
 * qu'une ligne change.
 *
 * `User` et `Md pass` portent des valeurs distinctes quand elles le sont —
 * un accès acheté en ligne a un nom et une référence — et la même des deux
 * côtés sur un ticket imprimé, où le client n'a qu'une chose à recopier.
 *
 * Tout le style est en ligne : le moteur n'accepte pas de balise `<style>`,
 * et c'est ce qui empêche un modèle de déborder sur la page entière.
 */
/**
 * Un pixel transparent, quand l'exploitant n'a pas encore de logo.
 *
 * `<img src="">` fait afficher au navigateur son icone d'image cassee : sur
 * une planche de trente tickets, cela fait trente petits carres barres qu'on
 * decoupe et qu'on donne au client. Un pixel invisible ne se voit pas, et la
 * mise en page ne bouge pas le jour ou le logo arrive.
 */
const PIXEL_VIDE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const DEFAULT_TEMPLATE = `<table style="width:100%;border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;color:#0f2b5b">
  <tr>
    <td style="width:9mm;background:#12539f;border-radius:3mm 0 0 3mm;text-align:center;vertical-align:middle;padding:1mm 0">
      <div style="color:#ffffff;font-size:11pt;font-weight:bold;white-space:nowrap;writing-mode:vertical-rl;transform:rotate(180deg)">{{price}}</div>
    </td>
    <td style="padding:1.5mm 2mm;vertical-align:top">
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="width:7mm;vertical-align:middle"><img src="{{logoUrl}}" alt="" style="width:6mm;height:6mm" /></td>
          <td style="vertical-align:middle;padding-left:1mm">
            <div style="font-size:8pt;font-weight:bold;letter-spacing:0.2pt">{{wifiName}}</div>
            <div style="font-size:5.5pt;color:#2f6fbf">{{tagline}}</div>
          </td>
        </tr>
      </table>
      <div style="font-size:11pt;font-weight:bold;margin-top:1mm">User : {{code}}</div>
      <div style="font-size:11pt;font-weight:bold">Md pass : {{password}}</div>
      <div style="font-size:6pt;color:#475569;margin-top:0.5mm">{{planName}} · {{validity}}</div>
      <hr style="border:0;border-top:0.2mm solid #d7e2f2;margin:1mm 0 0.7mm" />
      <div style="font-size:5.5pt;color:#334155;line-height:1.5">
        {{site}}<br />{{reseauSocial}}<br />{{telephones}}
      </div>
    </td>
    <td style="width:17mm;text-align:center;vertical-align:middle;padding:1mm">
      <img src="{{qrUrl}}" alt="" style="width:15mm;height:15mm" />
      <div style="font-size:4.5pt;color:#15803d;font-weight:bold;line-height:1.3">Scannez pour<br />vous connecter</div>
    </td>
  </tr>
</table>`;

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
      logoUrl: PIXEL_VIDE,
      password: String(6000 + i * 37).slice(0, 4),
      tagline: 'Restez connectés',
      site: 'wifitati.net',
      telephones: '+261 34 72 818 91',
      reseauSocial: 'Zone Wifi-TATI',
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
      // `accessPassword` sert au ticket : un accès acheté en ligne a un nom et
      // une référence distincts, et n'imprimer que le code laisserait le
      // client devant un champ qu'il ne peut pas remplir.
      orderBy: { createdAt: 'asc' },
    });
    if (vouchers.length === 0) {
      throw new NotFoundException('Aucun ticket à imprimer pour cette sélection');
    }

    const tenantId = this.tenantContext.requireTenantId();
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { wifiName: true, logoUrl: true, currency: true, domains: true },
    });
    /**
     * Les coordonnées viennent des réglages du portail captif.
     *
     * Le même exploitant, les mêmes numéros, la même page Facebook : les
     * redemander ici ferait deux endroits à tenir à jour, et un ticket
     * imprimé avec un ancien numéro ne se rattrape pas — il est déjà dans la
     * poche du client.
     */
    const coordonnees = await this.prisma.hotspotLoginPage.findUnique({
      where: { tenantId },
      select: { telephones: true, reseauSocial: true, sousTitre: true },
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
      logoUrl: tenant.logoUrl || PIXEL_VIDE,
      // Le code vaut des deux côtés sur un ticket imprimé : les deux lignes
      // portent alors la même chose, et c'est voulu — le client n'a qu'une
      // chose à recopier.
      password: voucher.accessPassword ?? voucher.code,
      tagline: coordonnees?.sousTitre ?? '',
      site: tenant.domains[0] ?? '',
      telephones: coordonnees?.telephones ?? '',
      reseauSocial: coordonnees?.reseauSocial ?? '',
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

/**
 * La validité d'une offre, **en heures**.
 *
 * Demandé tel quel, et la raison tient : l'exploitant vend des heures, ses
 * offres s'appellent « 2Heure-500Ar », et un ticket qui annonce « 30 j »
 * oblige le vendeur à convertir devant le client. Les deux écritures sont
 * vraies ; une seule est celle du commerce.
 *
 * En dessous de l'heure, les minutes : « 0,25 h » n'aide personne.
 */
function humanDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const heures = seconds / 3600;
  return `${Number.isInteger(heures) ? heures : heures.toFixed(1).replace('.', ',')} h`;
}
