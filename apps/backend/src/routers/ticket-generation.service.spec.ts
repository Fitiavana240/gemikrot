import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditResult } from '@prisma/client';
import { TicketGenerationService } from './ticket-generation.service.js';

const ROUTEUR = 'routeur-1';

/**
 * Un routeur de laboratoire réduit à ce que la génération touche.
 *
 * Il sait échouer **sur une partie seulement** du lot : c'est le cas qui
 * compte. Un compte User Manager créé sans attribution de profil n'ouvre
 * rien, et le laisser passer pour un ticket valide se découvrirait au
 * comptoir, devant le client.
 */
class RouteurDeLabo {
  profilsUm = ['TEST-1H', '1Mois-15000Ar'];
  profilsHotspot = ['2Heure-500Ar'];
  comptesUm: string[] = [];
  comptesHotspot: string[] = [];
  attributions: { username: string; profileName: string }[] = [];
  /** Les codes dont l'attribution (ou la création) doit échouer. */
  échouerSur = new Set<string>();

  async getUserManagerProfiles() {
    return this.profilsUm.map((name) => ({ name }));
  }
  async getHotspotProfiles() {
    return this.profilsHotspot.map((name) => ({ name }));
  }
  async createUserManagerUsers(inputs: { username: string }[]) {
    this.comptesUm.push(...inputs.map((i) => i.username));
    return [];
  }
  async assignProfile(input: { username: string; profileName: string }) {
    if (this.échouerSur.has(input.username)) throw new Error('profil refusé');
    this.attributions.push(input);
    return {};
  }
  async createHotspotUser(input: { username: string }) {
    if (this.échouerSur.has(input.username)) throw new Error('compte déjà existant');
    this.comptesHotspot.push(input.username);
    return {};
  }
}

describe('TicketGenerationService', () => {
  let mikrotik: RouteurDeLabo;
  let audit: { log: ReturnType<typeof vi.fn> };
  let service: TicketGenerationService;

  beforeEach(() => {
    mikrotik = new RouteurDeLabo();
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    service = new TicketGenerationService(
      { forRouter: async () => mikrotik } as never,
      audit as never,
    );
  });

  it('crée les comptes et leur attribue le profil demandé', async () => {
    const r = await service.generer(
      ROUTEUR,
      { cible: 'user-manager', profileName: 'TEST-1H', quantite: 3 },
      'admin-1',
    );

    expect(r.codes).toHaveLength(3);
    expect(mikrotik.comptesUm).toHaveLength(3);
    // Un compte sans attribution n'ouvre rien : les deux doivent aller de pair.
    expect(mikrotik.attributions.map((a) => a.profileName)).toEqual([
      'TEST-1H',
      'TEST-1H',
      'TEST-1H',
    ]);
  });

  it('tire des codes tous distincts', async () => {
    const r = await service.generer(
      ROUTEUR,
      { cible: 'user-manager', profileName: 'TEST-1H', quantite: 50 },
      'admin-1',
    );

    expect(new Set(r.codes).size).toBe(50);
  });

  it('applique le préfixe, pour qu\'un lot se reconnaisse sur le routeur', async () => {
    const r = await service.generer(
      ROUTEUR,
      { cible: 'user-manager', profileName: 'TEST-1H', quantite: 2, prefixe: 'SEP-' },
      'admin-1',
    );

    expect(r.codes.every((c) => c.startsWith('SEP-'))).toBe(true);
  });

  it("refuse un profil inexistant avant de créer quoi que ce soit", async () => {
    // Un nom mal orthographié produirait sinon des dizaines de comptes sans
    // forfait, qu'il faudrait retrouver et supprimer un par un.
    await expect(
      service.generer(
        ROUTEUR,
        { cible: 'user-manager', profileName: 'Inexistant', quantite: 10 },
        'admin-1',
      ),
    ).rejects.toThrow(/n'existe pas/);

    expect(mikrotik.comptesUm).toHaveLength(0);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('refuse une quantité hors bornes sans toucher au routeur', async () => {
    // Au-delà de 200, la requête dépasserait son délai en laissant des
    // comptes créés que l'appelant ne verrait jamais.
    for (const quantite of [0, 201]) {
      await expect(
        service.generer(ROUTEUR, { cible: 'user-manager', profileName: 'TEST-1H', quantite }, 'a'),
      ).rejects.toThrow(/entre 1 et 200/);
    }
    expect(mikrotik.comptesUm).toHaveLength(0);
  });

  it("signale les tickets dont l'attribution a échoué au lieu de les compter", async () => {
    // Le cas qui coûte cher : trois comptes créés, un sans forfait. Le
    // compter parmi les réussites le ferait vendre, et il n'ouvrirait rien.
    const vraiTirage = (service as never as { tirerCodes: (d: unknown) => string[] }).tirerCodes;
    (service as never as { tirerCodes: (d: unknown) => string[] }).tirerCodes = (d) => {
      const codes = vraiTirage.call(service, d);
      mikrotik.échouerSur.add(codes[1]);
      return codes;
    };

    const r = await service.generer(
      ROUTEUR,
      { cible: 'user-manager', profileName: 'TEST-1H', quantite: 3 },
      'admin-1',
    );

    expect(r.codes).toHaveLength(2);
    expect(r.echecs).toHaveLength(1);
    expect(r.echecs[0].motif).toContain('profil refusé');
    // Et l'audit ne déclare pas un succès.
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ result: AuditResult.FAILURE }),
    );
  });

  it('génère sur le HotSpot quand c\'est la cible', async () => {
    const r = await service.generer(
      ROUTEUR,
      { cible: 'hotspot', profileName: '2Heure-500Ar', quantite: 4 },
      'admin-1',
    );

    expect(r.cible).toBe('hotspot');
    expect(mikrotik.comptesHotspot).toHaveLength(4);
    // Pas d'attribution côté HotSpot : le profil est porté par le compte.
    expect(mikrotik.attributions).toHaveLength(0);
    expect(mikrotik.comptesUm).toHaveLength(0);
  });

  it('refuse un profil HotSpot inconnu sans se rabattre sur User Manager', async () => {
    // Les deux tables ont leurs propres profils : chercher dans la mauvaise
    // créerait des comptes au mauvais endroit.
    await expect(
      service.generer(
        ROUTEUR,
        { cible: 'hotspot', profileName: 'TEST-1H', quantite: 1 },
        'admin-1',
      ),
    ).rejects.toThrow(/n'existe pas/);
  });

  it('journalise la cible, le profil et ce qui a réellement été créé', async () => {
    await service.generer(
      ROUTEUR,
      { cible: 'user-manager', profileName: 'TEST-1H', quantite: 5 },
      'admin-7',
    );

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GENERATE_TICKETS',
        adminUserId: 'admin-7',
        routerId: ROUTEUR,
        result: AuditResult.SUCCESS,
        payloadDiff: expect.objectContaining({
          cible: 'user-manager',
          profileName: 'TEST-1H',
          demandes: 5,
          crees: 5,
          echecs: 0,
        }),
      }),
    );
  });
});
