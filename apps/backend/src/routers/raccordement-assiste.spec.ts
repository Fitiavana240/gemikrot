import { describe, expect, it, vi } from 'vitest';
import { RaccordementAssisteService } from './raccordement-assiste.service.js';

/**
 * Raccorder un routeur sans coller de script.
 *
 * Ce qui compte ici n'est pas la séquence d'appels REST — elle changera — mais
 * les trois promesses faites à l'exploitant au moment où il tape le mot de
 * passe administrateur de son routeur en production :
 *
 * 1. ce mot de passe ne part nulle part ailleurs ;
 * 2. rien n'est écrit sur un routeur qu'on n'a pas pu identifier ;
 * 3. la console ne bascule pas sur un tunnel qui n'a pas encore répondu.
 */

const ADMIN = { host: '192.168.88.1', username: 'admin', password: 'secret-du-routeur' };

function service(options: { version?: string; refuseSession?: boolean } = {}) {
  const ecritures: { chemin: string; corps: unknown }[] = [];
  const auditLog = vi.fn(async (_entree: { payloadDiff?: Record<string, unknown> }) => undefined);
  const creerRouteur = vi.fn(async (dto: Record<string, unknown>) => ({ id: 'r-neuf', ...dto }));
  const majRouteur = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));

  const get = vi.fn(async (chemin: string) => {
    if (options.refuseSession) throw new Error('401 Unauthorized');
    if (chemin === '/system/resource') {
      return { version: options.version ?? '7.24.4', 'board-name': 'hAP ac²' };
    }
    if (chemin === '/system/identity') return { name: 'hAP' };
    if (chemin === '/interface/wireguard') {
      // Au sondage la liste est vide ; après création elle porte la clé.
      return ecritures.some((e) => e.chemin === '/interface/wireguard')
        ? [{ name: 'gemikrot', 'public-key': 'CLE_PUBLIQUE_DU_ROUTEUR' }]
        : [];
    }
    return [];
  });

  const client = {
    get,
    put: vi.fn(async (chemin: string, corps: unknown) => {
      ecritures.push({ chemin, corps });
      return {};
    }),
    delete: vi.fn(async () => undefined),
  };

  const s = new RaccordementAssisteService(
    { router: { update: majRouteur } } as never,
    {} as never,
    {
      settings: {
        endpointHost: '192.168.88.23',
        endpointPort: 51820,
        publicKey: 'CLE_DU_SERVEUR',
        subnet: '10.88.0.0/16',
      },
      addPeer: vi.fn(async () => ({ applied: true })),
    } as never,
    { requireTenantId: () => 't1' } as never,
    { log: auditLog } as never,
    {
      probeFingerprint: vi.fn(async () => ({ fingerprint256: 'AA:BB' })),
      create: creerRouteur,
    } as never,
    { allocateAddress: vi.fn(async () => '10.88.0.7') } as never,
    { get: () => 'http://192.168.88.23:3000' } as never,
  );
  // Le client REST est jetable et bâti sur les identifiants de l'appel : on le
  // remplace ici plutôt que d'ouvrir une vraie connexion.
  (s as never as { client: () => unknown }).client = () => client;

  return { service: s, ecritures, auditLog, creerRouteur, majRouteur, client };
}

describe('le sondage', () => {
  it('reconnaît le routeur sans rien y écrire', async () => {
    const { service: s, ecritures } = service();

    const sondage = await s.sonder(ADMIN);

    expect(sondage.joignable).toBe(true);
    expect(sondage.versionSuffisante).toBe(true);
    expect(sondage.identite).toBe('hAP');
    expect(sondage.version).toBe('7.24.4');
    // Aucune écriture : c'est toute la raison d'être d'une étape séparée.
    expect(ecritures).toEqual([]);
  });

  it('refuse une version trop ancienne en disant quoi faire', async () => {
    // RouterOS 6 n'a ni WireGuard ni l'API REST. Échouer plus tard laisserait
    // une configuration à moitié écrite sur le matériel de quelqu'un.
    const { service: s } = service({ version: '6.49.10' });

    const sondage = await s.sonder(ADMIN);

    expect(sondage.versionSuffisante).toBe(false);
    expect(sondage.message).toMatch(/6\.49\.10/);
    expect(sondage.message).toMatch(/Check For Updates/);
  });

  it('distingue « ne répond pas » de « refuse le mot de passe »', async () => {
    // Les deux pannes n'ont pas le même remède : l'une est un service éteint,
    // l'autre un mot de passe. Les confondre envoie chercher au mauvais endroit.
    const { service: s } = service({ refuseSession: true });

    const sondage = await s.sonder(ADMIN);

    expect(sondage.joignable).toBe(false);
    expect(sondage.message).toMatch(/refuse ces identifiants/);
  });
});

describe('le raccordement', () => {
  it('ne laisse le mot de passe administrateur nulle part', async () => {
    // La promesse la plus importante de cet écran. Conserver les identifiants
    // maîtres ferait d'une intrusion sur la plateforme la prise de contrôle de
    // tous les routeurs de tous les exploitants.
    const { service: s, creerRouteur, auditLog, ecritures, majRouteur } = service();

    await s.raccorder({ ...ADMIN, label: 'hAP de Sanfily' });

    const traces = JSON.stringify([
      creerRouteur.mock.calls,
      auditLog.mock.calls,
      majRouteur.mock.calls,
      ecritures,
    ]);
    expect(traces).not.toContain(ADMIN.password);
    // Le compte enregistré est le compte dédié, jamais celui de l'exploitant.
    expect(creerRouteur.mock.calls[0][0].username).toBe('gemikrot-api');
    expect(creerRouteur.mock.calls[0][0].password).not.toBe(ADMIN.password);
  });

  it('trace qui a raccordé, sans de quoi le rejouer', async () => {
    const { service: s, auditLog } = service();

    await s.raccorder(ADMIN);

    const diff = auditLog.mock.calls[0][0].payloadDiff ?? {};
    expect(diff.compteEmploye).toBe('admin');
    expect(Object.values(diff)).not.toContain(ADMIN.password);
  });

  it('n’écrit rien sur un routeur en version trop ancienne', async () => {
    const { service: s, ecritures, creerRouteur } = service({ version: '6.49.10' });

    await expect(s.raccorder(ADMIN)).rejects.toThrow(/6\.49\.10/);

    expect(ecritures).toEqual([]);
    expect(creerRouteur).not.toHaveBeenCalled();
  });

  it('garde l’adresse locale et ne bascule pas sur le tunnel', async () => {
    // Un tunnel qui vient d'être posé n'a pas encore échangé de poignée de
    // main. Basculer dessus rendrait le routeur injoignable dans la seconde
    // qui suit un raccordement réussi.
    const { service: s, creerRouteur, majRouteur } = service();

    const res = await s.raccorder(ADMIN);

    expect(creerRouteur.mock.calls[0][0].host).toBe('192.168.88.1');
    expect(res.tunnelAddress).toBe('10.88.0.7');
    const data = majRouteur.mock.calls[0][0].data;
    expect(data.tunnelAddress).toBe('10.88.0.7');
    // `enrolledAt` est ce qui fait basculer la console sur le tunnel.
    expect(data.enrolledAt).toBeUndefined();
  });

  it('lit la clé publique sur le routeur au lieu de la fournir', async () => {
    // La clé privée naît sur le routeur et n'en sort jamais, pas même vers la
    // console qui pilote l'opération.
    const { service: s, majRouteur } = service();

    await s.raccorder(ADMIN);

    expect(majRouteur.mock.calls[0][0].data.tunnelPublicKey).toBe('CLE_PUBLIQUE_DU_ROUTEUR');
  });

  it('nettoie avant d’ajouter, pour qu’un second passage aboutisse', async () => {
    // L'exploitant qui recommence après une coupure est exactement celui qu'il
    // ne faut pas bloquer sur un « already have ».
    const { service: s, client } = service();

    await s.raccorder(ADMIN);

    // Chaque ajout est précédé d'une lecture de l'existant sur le même chemin.
    const lus = client.get.mock.calls.map((c) => c[0]);
    for (const chemin of ['/interface/wireguard', '/ip/address', '/ip/route', '/user']) {
      expect(lus).toContain(chemin);
    }
  });

  it('pose le pair du serveur avec la clé du routeur', async () => {
    const { service: s, ecritures } = service();

    const res = await s.raccorder(ADMIN);

    const pair = ecritures.find((e) => e.chemin === '/interface/wireguard/peers')
      ?.corps as Record<string, string>;
    expect(pair['public-key']).toBe('CLE_DU_SERVEUR');
    expect(pair['endpoint-address']).toBe('192.168.88.23');
    expect(pair['persistent-keepalive']).toBe('25');
    expect(res.etapes.join(' ')).toMatch(/pair sur le serveur/);
  });
});
