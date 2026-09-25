import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { HotspotService } from './hotspot.service.js';

/**
 * Contourner le portail, et limiter ce qu'on laisse passer.
 *
 * Un appareil en `bypassed` ne se connecte jamais : il n'a ni compte, ni
 * profil HotSpot, donc **aucune des limites que porte un profil**. Sans file
 * d'attente, il prend tout ce qu'il peut — et c'est justement l'appareil
 * qu'on contourne parce qu'il compte : la caisse, la télévision, le téléphone
 * du gérant. Celui dont on remarquerait le moins vite qu'il sature la ligne.
 *
 * Deux pièges que ces épreuves tiennent :
 *
 * 1. Une file vise une **adresse**, jamais une MAC. Demander une limite sans
 *    adresse fixe poserait une file sur du vide : elle ne limiterait rien, et
 *    rien ne le dirait.
 * 2. Retirer le contournement doit retirer la file. Sinon elle survit à
 *    l'appareil et vise une adresse que le prochain bail DHCP donnera à
 *    quelqu'un d'autre, qui héritera d'une limite que personne n'a voulue.
 */

function service(
  options: { bindings?: unknown[]; queues?: unknown[]; hotes?: unknown[] } = {},
) {
  const mikrotik = {
    getHotspotHosts: vi.fn(async () => options.hotes ?? []),
    removeHotspotHost: vi.fn(async () => undefined),
    createIpBinding: vi.fn(async (b: Record<string, unknown>) => ({ id: '*1', ...b })),
    createSimpleQueue: vi.fn(async (q: Record<string, unknown>) => ({ id: '*9', ...q })),
    deleteIpBinding: vi.fn(async () => undefined),
    deleteSimpleQueue: vi.fn(async () => undefined),
    setIpBindingType: vi.fn(async (id: string, type: string) => ({
      id,
      type,
      macAddress: 'AA:BB:CC:DD:EE:FF',
    })),
    getIpBindings: vi.fn(async () => options.bindings ?? []),
    getSimpleQueues: vi.fn(async () => options.queues ?? []),
  };
  const s = new HotspotService(
    { scopedStrict: { router: { findUnique: vi.fn(async () => ({ id: 'r1' })) } } } as never,
    { forRouter: async () => mikrotik, forDefaultRouter: async () => mikrotik } as never,
    { log: vi.fn(async () => undefined) } as never,
    { verifier: vi.fn(async () => undefined) } as never,
  );
  return { service: s, mikrotik };
}

const MAC = 'AA:BB:CC:DD:EE:FF';

describe('le contournement du portail', () => {
  it('pose la file sur l’adresse, avec les deux sens du plafond', async () => {
    const { service: s, mikrotik } = service();

    await s.creerContournement(
      {
        macAddress: MAC,
        type: 'bypassed',
        address: '192.168.88.50',
        comment: 'Caisse',
        limiteMontanteBps: 1_000_000,
        limiteDescendanteBps: 4_000_000,
      },
      'admin-1',
      'r1',
    );

    expect(mikrotik.createIpBinding).toHaveBeenCalledWith(
      expect.objectContaining({ macAddress: MAC, type: 'bypassed', address: '192.168.88.50' }),
    );
    expect(mikrotik.createSimpleQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        target: '192.168.88.50',
        maxLimitUpload: 1_000_000,
        maxLimitDownload: 4_000_000,
      }),
    );
  });

  it('refuse une limite sans adresse fixe, plutôt que de poser une file sur du vide', async () => {
    const { service: s, mikrotik } = service();

    await expect(
      s.creerContournement(
        {
          macAddress: MAC,
          type: 'bypassed',
          limiteMontanteBps: 1_000_000,
          limiteDescendanteBps: 4_000_000,
        },
        'admin-1',
        'r1',
      ),
    ).rejects.toThrow(BadRequestException);

    // Et rien n'a été posé : un contournement créé puis une limite refusée
    // laisserait l'appareil passer sans limite, ce qu'on cherchait à éviter.
    expect(mikrotik.createIpBinding).not.toHaveBeenCalled();
  });

  it('laisse passer un contournement sans limite : tout appareil n’en veut pas', async () => {
    const { service: s, mikrotik } = service();

    await s.creerContournement({ macAddress: MAC, type: 'bypassed' }, 'admin-1', 'r1');

    expect(mikrotik.createIpBinding).toHaveBeenCalled();
    expect(mikrotik.createSimpleQueue).not.toHaveBeenCalled();
  });

  it('retire la file avec le contournement', async () => {
    const { service: s, mikrotik } = service({
      bindings: [{ id: '*1', macAddress: MAC }],
      queues: [{ id: '*9', name: `GeMikrot ${MAC}`, dynamic: false }],
    });

    const r = await s.supprimerContournement('*1', 'admin-1', 'r1');

    expect(mikrotik.deleteIpBinding).toHaveBeenCalledWith('*1');
    expect(mikrotik.deleteSimpleQueue).toHaveBeenCalledWith('*9');
    expect(r.fileRetiree).toBe(`GeMikrot ${MAC}`);
  });

  it('ne touche pas aux files du HotSpot, qui se refont seules', async () => {
    const { service: s, mikrotik } = service({
      bindings: [{ id: '*1', macAddress: MAC }],
      // Une file dynamique portant par hasard le même nom : le HotSpot les
      // crée à chaque session et les détruit à la déconnexion.
      queues: [{ id: '*9', name: `GeMikrot ${MAC}`, dynamic: true }],
    });

    await s.supprimerContournement('*1', 'admin-1', 'r1');

    expect(mikrotik.deleteSimpleQueue).not.toHaveBeenCalled();
  });
});

/**
 * Un contournement pose ne s'applique pas a un appareil deja connu.
 *
 * RouterOS decide du sort d'un appareil **a son arrivee** et garde sa
 * decision tant qu'il est la. Un appareil qui parlait au portail avant qu'on
 * ajoute son contournement continue donc de voir la page de connexion : le
 * contournement existe, il est simplement arrive trop tard.
 *
 * Constate le 25/09/2026 -- << Test PC >>, vu par le routeur, contournement
 * en place, et l'ecran du client affichant encore << action requise >>.
 */
describe("l'application d'un contournement", () => {
  const HOTE = { id: '*a1', macAddress: MAC, bypassed: false };

  it("retire l'hote pour que le routeur repose la question", async () => {
    const { service: s, mikrotik } = service({
      bindings: [{ id: '*1', macAddress: MAC, type: 'bypassed', disabled: false }],
      hotes: [HOTE],
    });

    const r = await s.appliquerContournement('*1', 'admin-1', 'r1');

    expect(mikrotik.removeHotspotHost).toHaveBeenCalledWith('*a1');
    expect(r.deja).toBe(false);
  });

  it('ne touche a rien quand le contournement passe deja', async () => {
    const { service: s, mikrotik } = service({
      bindings: [{ id: '*1', macAddress: MAC, type: 'bypassed', disabled: false }],
      hotes: [{ ...HOTE, bypassed: true }],
    });

    const r = await s.appliquerContournement('*1', 'admin-1', 'r1');

    expect(mikrotik.removeHotspotHost).not.toHaveBeenCalled();
    expect(r.deja).toBe(true);
  });

  it("dit que la MAC n'est celle d'aucun appareil, plutot que d'echouer", async () => {
    const { service: s, mikrotik } = service({
      bindings: [{ id: '*1', macAddress: MAC, type: 'bypassed', disabled: false }],
      hotes: [],
    });

    // Le cas le plus frequent : les telephones tirent une adresse differente
    // par reseau Wi-Fi, et celle des reglages n'est pas celle que voit le
    // routeur. Le message doit le dire, sinon on cherche ailleurs.
    await expect(s.appliquerContournement('*1', 'admin-1', 'r1')).rejects.toThrow(
      /jamais vu/,
    );
    expect(mikrotik.removeHotspotHost).not.toHaveBeenCalled();
  });

  it("refuse sur une ligne qui n'est pas un contournement actif", async () => {
    const { service: s, mikrotik } = service({
      // Retirer l'hote d'un client authentifie fermerait sa session, et il se
      // retrouverait devant la page de connexion sans avoir rien demande.
      bindings: [{ id: '*1', macAddress: MAC, type: 'regular', disabled: false }],
      hotes: [HOTE],
    });

    await expect(s.appliquerContournement('*1', 'admin-1', 'r1')).rejects.toThrow(
      /pas un contournement actif/,
    );
    expect(mikrotik.removeHotspotHost).not.toHaveBeenCalled();
  });
});
