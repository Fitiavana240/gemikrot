import { describe, expect, it, vi } from 'vitest';
import {
  RaccordementAssisteService,
  messageDeSondageRate,
} from './raccordement-assiste.service.js';

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

function service(
  options: { version?: string; refuseSession?: boolean; deja?: { id: string } | null } = {},
) {
  const ecritures: { chemin: string; corps: unknown }[] = [];
  const auditLog = vi.fn(async (_entree: { payloadDiff?: Record<string, unknown> }) => undefined);
  const creerRouteur = vi.fn(async (dto: Record<string, unknown>) => ({ id: 'r-neuf', ...dto }));
  const majFiche = vi.fn(async (id: string, _dto: Record<string, unknown>) => ({ id }));
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
    {
      router: { update: majRouteur },
      scopedStrict: { router: { findFirst: vi.fn(async () => options.deja ?? null) } },
    } as never,
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
      update: majFiche,
    } as never,
    { allocateAddress: vi.fn(async () => '10.88.0.7') } as never,
    { get: () => 'http://192.168.88.23:3000' } as never,
  );
  // Le client REST est jetable et bâti sur les identifiants de l'appel : on le
  // remplace ici plutôt que d'ouvrir une vraie connexion.
  (s as never as { client: () => unknown }).client = () => client;

  return { service: s, ecritures, auditLog, creerRouteur, majFiche, majRouteur, client };
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

describe('le routeur deja connu', () => {
  it('reprend sa fiche au lieu d’en creer une seconde', async () => {
    // Arrive des le premier usage sur ce parc : deux lignes pour le meme hAP,
    // deux entrees dans le selecteur, et un import qui compterait en double.
    const { service: s, creerRouteur, majFiche } = service({ deja: { id: 'r-connu' } });

    const res = await s.raccorder(ADMIN);

    expect(creerRouteur).not.toHaveBeenCalled();
    expect(majFiche).toHaveBeenCalledTimes(1);
    expect(majFiche.mock.calls[0][0]).toBe('r-connu');
    expect(res.routerId).toBe('r-connu');
    expect(res.etapes.join(' ')).toMatch(/pas dupliqu/);
  });

  it('remplace les identifiants, que le routeur vient de changer', async () => {
    // Le script recree le compte dedie avec un nouveau mot de passe : garder
    // l'ancien en base rendrait la console muette sur un routeur qui repond.
    const { service: s, majFiche } = service({ deja: { id: 'r-connu' } });

    await s.raccorder(ADMIN);

    const dto = majFiche.mock.calls[0][1];
    expect(dto.username).toBe('gemikrot-api');
    expect(dto.password).toBeTruthy();
    expect(dto.password).not.toBe(ADMIN.password);
    // Le nom n'est pas ecrase : l'exploitant l'a peut-etre choisi.
    expect(dto.label).toBeUndefined();
  });
});

describe('pourquoi le sondage a rate', () => {
  it('reconnait un routeur sans certificat, et renvoie au script', () => {
    /**
     * Le cas exact de ce parc : le port repond, puis coupe. Deux services TLS
     * tombaient ensemble — `www-ssl` sechement, `api-ssl` avec un
     * << handshake_failure >> — les deux pour la meme raison.
     *
     * Le message ne doit surtout pas renvoyer vers un terminal Winbox : la
     * regle de ce produit est qu'on n'y tape rien, on n'y colle que ce que la
     * console a genere. Une panne qu'on ne sait reparer qu'a la main est une
     * panne qu'on ne repare pas.
     */
    const m = messageDeSondageRate(
      '192.168.88.1',
      443,
      new Error('Client network socket disconnected before secure TLS connection was established'),
    );

    expect(m).toMatch(/pas de certificat utilisable/);
    expect(m).toMatch(/script/);
    expect(m).not.toMatch(/Winbox/);
  });

  it('distingue un routeur qui ne repond pas du tout', () => {
    // Rien a reparer depuis la console : le routeur est eteint ou ailleurs.
    const m = messageDeSondageRate('192.168.88.1', 443, new Error('connect ECONNREFUSED'));

    expect(m).toMatch(/Aucune réponse/);
    expect(m).not.toMatch(/pas de certificat utilisable/);
  });

  it('traite un delai depasse comme une absence de reponse', () => {
    const m = messageDeSondageRate('192.168.88.1', 443, new Error('connect ETIMEDOUT'));

    expect(m).toMatch(/Aucune réponse/);
  });
});
