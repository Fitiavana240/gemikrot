import { describe, expect, it, vi } from 'vitest';
import { PlancheRouteurService } from './planche-routeur.service.js';
import { TicketPdfService } from './ticket-pdf.service.js';
import { LIMITE_CONTENU_ROUTEUR, LIMITE_LECTURE_ROUTEUR } from './pdf.util.js';

/**
 * Un routeur qui accepte les écritures et sait dire où sont ses disques.
 *
 * `getRouterFiles` sert à choisir la racine : la clé USB si elle est là, rien
 * sinon — la flash de ce hAP n'a que 278 Ko libres.
 */
function routeur(écrits: { nom: string; contenu: string }[]) {
  return {
    getRouterFiles: vi.fn(async () => [
      { name: 'usb1-part1', type: 'disk', path: 'usb1-part1' },
    ]),
    writeRouterFile: vi.fn(async (nom: string, contenu: string) => {
      if (contenu.length > LIMITE_CONTENU_ROUTEUR) throw new Error('contents too long');
      écrits.push({ nom, contenu });
    }),
  } as never;
}

function tickets(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    code: `ZZTEST${String(i).padStart(4, '0')}`,
    offre: '2 Heure',
    prix: '500 Ar',
  }));
}

const DEMANDE = {
  étiquette: '2Heure-500Ar-202609210230',
  tickets: tickets(6),
  validitéSecondes: 7_200,
  réseau: 'WIFI-TATI',
  domaines: ['portail.wifitati.mg'],
  parPage: 30,
};

describe('PlancheRouteurService', () => {
  it('joint le PDF à la réponse, faute de pouvoir le relire ensuite', async () => {
    // C'est la raison d'être de `pdfBase64`, et elle est mesurée : le routeur
    // rend une chaîne vide pour tout fichier d'au moins 4 096 octets, et
    // masque les mots de passe. Passé la réponse, la planche est perdue pour
    // la console — d'où ce test, qui interdit de retirer le champ.
    const écrits: { nom: string; contenu: string }[] = [];
    const service = new PlancheRouteurService(new TicketPdfService());

    const rapport = await service.écrire(routeur(écrits), DEMANDE as never);

    expect(rapport.planches).toHaveLength(1);
    const planche = rapport.planches[0];
    expect(planche.pdfBase64).not.toBe('');
    // Le base64 doit redonner exactement ce qui est parti sur le routeur.
    expect(Buffer.from(planche.pdfBase64, 'base64').toString('latin1')).toBe(écrits[0].contenu);
    expect(planche.octets).toBe(écrits[0].contenu.length);
  });

  it('produit un PDF que le routeur ne saurait pas rendre', async () => {
    // Si une planche passait un jour sous 4 096 octets, le champ deviendrait
    // superflu — ce test dit noir sur blanc que ce n'est pas le cas, et
    // préviendra si l'hypothèse change.
    const écrits: { nom: string; contenu: string }[] = [];
    const service = new PlancheRouteurService(new TicketPdfService());

    await service.écrire(routeur(écrits), DEMANDE as never);

    expect(écrits[0].contenu.length).toBeGreaterThan(LIMITE_LECTURE_ROUTEUR);
  });

  it('commence bien par un en-tête PDF, et rien avant', async () => {
    const écrits: { nom: string; contenu: string }[] = [];
    const service = new PlancheRouteurService(new TicketPdfService());

    const rapport = await service.écrire(routeur(écrits), DEMANDE as never);

    expect(Buffer.from(rapport.planches[0].pdfBase64, 'base64').toString('latin1')).toMatch(
      /^%PDF-1\.\d/,
    );
  });
});
