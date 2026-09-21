import { describe, expect, it, vi } from 'vitest';
import { HotspotService } from './hotspot.service.js';

/**
 * Poser un plafond de durée sur les comptes qui n'en ont pas.
 *
 * Sans `limit-uptime`, un ticket HotSpot ne finit jamais : le
 * `session-timeout` du profil coupe la session en cours mais repart à zéro à
 * chaque reconnexion, que le cookie rend automatique. Relevé sur le parc :
 * 228 comptes dans ce cas, sans plafond d'octets non plus.
 */
function compte(champs: {
  username: string;
  profile: string;
  uptimeSeconds?: number;
  limitUptimeSeconds?: number | null;
  disabled?: boolean;
}) {
  return {
    username: champs.username,
    profile: champs.profile,
    uptimeSeconds: champs.uptimeSeconds ?? 0,
    limitUptimeSeconds: champs.limitUptimeSeconds ?? null,
    disabled: champs.disabled ?? false,
  };
}

function service(
  comptes: ReturnType<typeof compte>[],
  offresTicket: string[] = ['2Heure-500Ar'],
) {
  const updateHotspotUser = vi.fn(async () => ({}));
  const mikrotik = {
    getHotspotUsers: vi.fn(async () => comptes),
    getHotspotProfiles: vi.fn(async () => [
      { name: '2Heure-500Ar', sessionTimeoutSeconds: 7200 },
      { name: '1Mois-15000Ar', sessionTimeoutSeconds: 2_592_000 },
      { name: 'Admin', sessionTimeoutSeconds: null },
    ]),
    updateHotspotUser,
  };
  const prisma = {
    scopedStrict: {
      plan: {
        findMany: vi.fn(async () =>
          offresTicket.map((mikrotikProfileName) => ({ mikrotikProfileName })),
        ),
      },
    },
  };
  const svc = new HotspotService(
    prisma as never,
    { forDefaultRouter: async () => mikrotik, forRouter: async () => mikrotik } as never,
    { log: vi.fn() } as never,
    {} as never,
  );
  return { svc, updateHotspotUser };
}

describe('HotspotService.plafonds', () => {
  it('n’écrit rien tant qu’on ne le demande pas', async () => {
    // L'aperçu est le mode par défaut : poser un plafond sur des comptes en
    // vente se regarde avant de se faire.
    const { svc, updateHotspotUser } = service([
      compte({ username: 'H718942', profile: '2Heure-500Ar' }),
    ]);

    const r = await svc.plafonds(undefined);

    expect(r.appliqué).toBe(false);
    expect(r.aCorriger).toHaveLength(1);
    expect(updateHotspotUser).not.toHaveBeenCalled();
  });

  it('épargne un abonnement au mois, même à zéro heure', async () => {
    // LE test de ce fichier. `1Mois-15000Ar` porte `session-timeout=4w2d` :
    // rien dans le profil ne le distingue d'un ticket. Un plafond de durée le
    // couperait au bout de trente jours PASSÉS EN LIGNE, ce qui n'a aucun
    // rapport avec le mois calendaire qu'il a acheté. Seule la console sait
    // lequel est un abonnement — c'est le `kind` de l'offre.
    const { svc, updateHotspotUser } = service([
      compte({ username: 'Soaragnetre', profile: '1Mois-15000Ar', uptimeSeconds: 0 }),
    ]);

    const r = await svc.plafonds(undefined, { appliquer: true });

    expect(r.aCorriger).toHaveLength(0);
    expect(r.ignorés[0]!.motif).toMatch(/carte/);
    expect(updateHotspotUser).not.toHaveBeenCalled();
  });

  it('épargne un compte déjà entamé', async () => {
    // Poser le plafond maintenant raccourcirait ce que le client a déjà, et
    // pourrait le couper en pleine session.
    const { svc, updateHotspotUser } = service([
      compte({ username: 'H776921', profile: '2Heure-500Ar', uptimeSeconds: 4524 }),
    ]);

    const r = await svc.plafonds(undefined, { appliquer: true });

    expect(r.ignorés[0]!.motif).toBe('déjà utilisé');
    expect(updateHotspotUser).not.toHaveBeenCalled();
  });

  it('épargne un compte bloqué', async () => {
    const { svc } = service([
      compte({ username: 'H863057', profile: '2Heure-500Ar', disabled: true }),
    ]);

    const r = await svc.plafonds(undefined, { appliquer: true });

    expect(r.ignorés[0]!.motif).toBe('bloqué');
  });

  it('ne retouche pas un compte qui a déjà un plafond', async () => {
    const { svc } = service([
      compte({ username: 'H762565', profile: '2Heure-500Ar', limitUptimeSeconds: 7200 }),
    ]);

    const r = await svc.plafonds(undefined);

    expect(r.aCorriger).toHaveLength(0);
    expect(r.ignorés).toHaveLength(0);
  });

  it('pose la durée du profil, et compte ce qu’il a fait', async () => {
    const { svc, updateHotspotUser } = service([
      compte({ username: 'H718942', profile: '2Heure-500Ar' }),
      compte({ username: 'H802044', profile: '2Heure-500Ar' }),
    ]);

    const r = await svc.plafonds(undefined, { appliquer: true });

    expect(r.corrigés).toBe(2);
    expect(updateHotspotUser).toHaveBeenCalledWith({
      username: 'H718942',
      limitUptimeSeconds: 7200,
    });
  });

  it('un échec n’arrête pas les autres', async () => {
    // Mieux vaut 227 plafonds posés et un échec nommé que rien du tout.
    const { svc, updateHotspotUser } = service([
      compte({ username: 'KO', profile: '2Heure-500Ar' }),
      compte({ username: 'OK', profile: '2Heure-500Ar' }),
    ]);
    updateHotspotUser.mockImplementationOnce(async () => {
      throw new Error('routeur grognon');
    });

    const r = await svc.plafonds(undefined, { appliquer: true });

    expect(r.corrigés).toBe(1);
    expect(r.échecs).toEqual([{ username: 'KO', motif: 'routeur grognon' }]);
  });
});
