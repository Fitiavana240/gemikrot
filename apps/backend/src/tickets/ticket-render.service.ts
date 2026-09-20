import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

/** Valeurs qu'un modèle peut réclamer. Toute autre est rendue vide. */
export interface TicketPlaceholders {
  code: string;
  planName: string;
  price: string;
  currency: string;
  validity: string;
  wifiName: string;
  logoUrl: string;
  createdAt: string;
  ticketIndex: string;
  ticketTotal: string;
  /**
   * QR code du ticket, en image prête à poser dans un `<img src>`.
   *
   * Il encode l'adresse de connexion du portail quand un domaine est déclaré
   * — scanner suffit alors à ouvrir la session — et le code seul sinon.
   */
  qrUrl: string;
}

export const PLACEHOLDER_HELP: { name: keyof TicketPlaceholders; description: string }[] = [
  { name: 'code', description: "Code d'accès du ticket — à la fois identifiant et mot de passe" },
  { name: 'planName', description: "Nom de l'offre, par exemple 1Jour-2000Ar" },
  { name: 'price', description: 'Prix formaté dans votre devise' },
  { name: 'currency', description: 'Code de la devise (MGA, EUR…)' },
  { name: 'validity', description: 'Durée de validité en clair, par exemple « 1 j »' },
  { name: 'wifiName', description: 'Nom de votre réseau Wi-Fi' },
  { name: 'logoUrl', description: 'Adresse de votre logo, à placer dans un src d\'image' },
  { name: 'createdAt', description: 'Date de génération du ticket' },
  { name: 'ticketIndex', description: 'Numéro du ticket dans le lot' },
  { name: 'ticketTotal', description: 'Nombre de tickets du lot' },
  {
    name: 'qrUrl',
    description:
      "QR code du ticket, à placer dans un src d'image. Il connecte le client d'un scan si un domaine de portail est déclaré dans Paramètres ; sinon il porte seulement le code",
  },
];

/**
 * Ce qu'un modele a le droit de contenir. Liste **blanche** : tout ce qui
 * n'y figure pas est retire, y compris ce a quoi personne n'a pense. Une
 * liste noire laisserait passer la prochaine trouvaille.
 */
const ALLOWED: sanitizeHtml.IOptions = {
  allowedTags: [
    'div', 'span', 'p', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4',
    'b', 'i', 'strong', 'em', 'small', 'u',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'ul', 'ol', 'li',
    'img',
  ],
  allowedAttributes: {
    '*': ['class', 'style', 'align'],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  // Une image peut venir d'une adresse web ou etre embarquee en base64 ;
  // `javascript:` et consorts sont exclus faute d'y figurer.
  allowedSchemes: ['http', 'https', 'data'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  disallowedTagsMode: 'discard',
};

export class TemplateRejected extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Modèle refusé : ${reasons.join(', ')}`);
  }
}

/**
 * Transforme un modèle HTML en page imprimable.
 *
 * **Le modèle est écrit par un ADMIN et ouvert par un OPERATEUR ou un
 * VIEWER.** Le jeton de session vit dans le `localStorage` du navigateur : un
 * script glissé dans un modèle volerait la session de qui ouvre l'aperçu.
 * Quatre couches, dans cet ordre d'importance :
 *
 * 1. Le rendu se fait dans une `<iframe sandbox="" srcdoc>` côté navigateur.
 *    Sans `allow-scripts` ni `allow-same-origin`, aucun script ne s'exécute
 *    et rien n'atteint le `localStorage`. C'est la protection réelle, et
 *    c'est le navigateur qui l'applique.
 * 2. Une `Content-Security-Policy` est posée en tête du document rendu.
 * 3. Les valeurs substituées sont échappées : un nom d'offre contenant des
 *    chevrons ne peut pas introduire de balise.
 * 4. Le modèle est confronté à une liste blanche à l'enregistrement, et
 *    refusé — pas nettoyé en silence — s'il contient autre chose que de la
 *    mise en forme.
 */
@Injectable()
export class TicketRenderService {
  /**
   * Refuse un modèle qui contient autre chose que de la mise en forme.
   *
   * Le modèle est passé à l'assainisseur, puis **comparé** à l'original : ce
   * qui a disparu est ce qui n'avait pas le droit d'être là. Le modèle est
   * alors rejeté avec la liste de ce qui posait problème, plutôt qu'enregistré
   * amputé — un admin doit savoir que son modèle a été refusé, pas le croire
   * correct jusqu'à la première impression.
   */
  assertSafe(html: string): void {
    if (sanitizeHtml(html, ALLOWED) === html) return;

    const allowedTags = ALLOWED.allowedTags as string[];
    const removed = new Set<string>();
    for (const [, tag] of html.matchAll(/<\s*([a-zA-Z][a-zA-Z0-9]*)/g)) {
      if (!allowedTags.includes(tag.toLowerCase())) removed.add(`balise <${tag.toLowerCase()}>`);
    }
    for (const [, attribute] of html.matchAll(/\s(on[a-zA-Z]+)\s*=/g)) {
      removed.add(`attribut ${attribute}`);
    }
    if (/javascript\s*:/i.test(html)) removed.add('adresse javascript:');

    throw new TemplateRejected(
      removed.size > 0
        ? [...removed]
        : ['du contenu non autorisé — seule la mise en forme est acceptée'],
    );
  }

  /**
   * Remplace les placeholders connus. Un placeholder inconnu est rendu vide
   * et signalé : l'admin voit pourquoi sa case reste blanche.
   */
  renderOne(
    template: string,
    values: TicketPlaceholders,
  ): { html: string; unknownPlaceholders: string[] } {
    const unknown = new Set<string>();

    const html = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => {
      if (name in values) return escapeHtml(String(values[name as keyof TicketPlaceholders] ?? ''));
      unknown.add(name);
      return '';
    });

    return { html, unknownPlaceholders: [...unknown] };
  }

  /**
   * Page complète : la grille et sa mise en page d'impression.
   *
   * 30 tickets par A4 donnent une cellule de 64,6 × 28,1 mm — le tiers d'une
   * carte de visite. `break-inside: avoid` empêche qu'un ticket soit coupé
   * entre deux pages.
   */
  renderSheet(
    template: string,
    tickets: TicketPlaceholders[],
    options: { perPage: number; title: string },
  ): { html: string; unknownPlaceholders: string[] } {
    const columns = columnsFor(options.perPage);
    const unknown = new Set<string>();

    const cells = tickets
      .map((values, index) => {
        const rendered = this.renderOne(template, {
          ...values,
          ticketIndex: String(index + 1),
          ticketTotal: String(tickets.length),
        });
        rendered.unknownPlaceholders.forEach((name) => unknown.add(name));
        return `<div class="ticket">${rendered.html}</div>`;
      })
      .join('\n');

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'">
<title>${escapeHtml(options.title)}</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #0f172a;
    background: #ffffff;
  }
  .sheet {
    display: grid;
    grid-template-columns: repeat(${columns}, 1fr);
    gap: 2mm;
  }
  .ticket {
    border: 1px dashed #94a3b8;
    border-radius: 2mm;
    padding: 2mm;
    overflow: hidden;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .ticket img { max-width: 100%; max-height: 8mm; object-fit: contain; }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  }
</style>
</head>
<body><div class="sheet">
${cells}
</div></body>
</html>`;

    return { html, unknownPlaceholders: [...unknown] };
  }
}

/** Grille adaptée au nombre de tickets par page. */
function columnsFor(perPage: number): number {
  if (perPage >= 30) return 3;
  if (perPage >= 12) return 3;
  if (perPage >= 6) return 2;
  return 1;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
