import { describe, expect, it } from 'vitest';
import { LIMITE_CONTENU_ROUTEUR, texteSûr } from './pdf.util.js';
import { TicketPdfService, validitéEnHeures } from './ticket-pdf.service.js';

const service = new TicketPdfService();

function planche(nombre: number, options: Partial<Parameters<TicketPdfService['planche']>[0]> = {}) {
  return service.planche({
    tickets: Array.from({ length: nombre }, (_, i) => ({
      code: `CODE${String(i).padStart(6, '0')}`,
      offre: '2Heure-500Ar',
      prix: '500 MGA',
    })),
    validitéSecondes: 7200,
    réseau: 'Zone WIFI-TATI',
    domaines: [],
    parPage: 30,
    ...options,
  });
}

describe('planche PDF', () => {
  /**
   * La contrainte qui décide de tout le reste.
   *
   * Le PDF part sur le routeur par `PUT /rest/file`, dont le champ `contents`
   * voyage dans du JSON : un seul octet au-delà de 127 serait ré-encodé en
   * UTF-8 en route, et le fichier arriverait corrompu. C'est pour cela que les
   * flux sont réencodés en ASCII85 et les accents écrits en octal.
   */
  it('ne produit que de l’ASCII', () => {
    const pdf = planche(30, { réseau: 'Réseau des Hautes-Terres — Tuléar' });

    const fautif = [...pdf].find((c) => c.charCodeAt(0) > 127);
    expect(fautif, `caractère hors ASCII : ${fautif}`).toBeUndefined();
  });

  it('reste un PDF que les lecteurs reconnaissent', () => {
    const pdf = planche(5);

    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    // La table de références croisées : sans elle, beaucoup de lecteurs
    // refusent le fichier au lieu de le réparer.
    expect(pdf).toContain('\nxref\n');
    expect(pdf).toContain('startxref');
  });

  it('tient dans ce que le routeur accepte, planche pleine', () => {
    // 30 tickets avec un QR qui encode une URL de portail : le cas le plus
    // lourd du parc. Sans compression il pesait 200 Ko, trois fois la limite.
    const pdf = planche(30, { domaines: ['portail.wifitati.mg'] });

    expect(pdf.length).toBeLessThanOrEqual(LIMITE_CONTENU_ROUTEUR);
  });

  it('pagine au-delà d’une planche', () => {
    // Deux pages dans un même document : le routeur, lui, recevra un fichier
    // par planche, mais le générateur doit savoir en produire plusieurs.
    expect(planche(45)).toContain('/Count 2');
    expect(planche(30)).toContain('/Count 1');
  });
});

describe('texteSûr', () => {
  it('échappe ce qui casserait la syntaxe PDF', () => {
    // Une parenthèse dans un nom d'offre fermerait la chaîne et rendrait tout
    // le fichier illisible.
    expect(texteSûr('Offre (promo)')).toBe('Offre \\(promo\\)');
    expect(texteSûr('a\\b')).toBe('a\\\\b');
  });

  it('écrit les accents en octal plutôt qu’en octets', () => {
    // « é » vaut 0xE9 en WinAnsi, soit 351 en octal. L'écrire tel quel
    // sortirait de l'ASCII et corromprait le fichier à l'envoi.
    expect(texteSûr('été')).toBe('\\351t\\351');
  });
});

describe('validitéEnHeures', () => {
  /**
   * Demandé tel quel : l'exploitant vend des heures et ses offres s'appellent
   * « 2Heure-500Ar ». Un ticket qui annoncerait « 30 j » obligerait le vendeur
   * à convertir devant le client.
   */
  it('rend des heures, y compris pour les longues durées', () => {
    expect(validitéEnHeures(7200)).toBe('2 h');
    expect(validitéEnHeures(14400)).toBe('4 h');
    expect(validitéEnHeures(86400)).toBe('24 h');
    expect(validitéEnHeures(604800)).toBe('168 h');
    expect(validitéEnHeures(2592000)).toBe('720 h');
  });

  it('descend aux minutes sous l’heure', () => {
    // « 0,25 h » n'aide personne au comptoir.
    expect(validitéEnHeures(900)).toBe('15 min');
  });

  it('ne fabrique pas de durée quand il n’y en a pas', () => {
    expect(validitéEnHeures(null)).toBe('sans limite');
    expect(validitéEnHeures(0)).toBe('sans limite');
  });
});
