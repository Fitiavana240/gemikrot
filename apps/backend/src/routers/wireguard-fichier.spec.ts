import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WireguardService } from './wireguard.service.js';

/**
 * La console écrit le pair, au lieu de l'afficher.
 *
 * C'était la marche manquante de l'escalier. Le serveur ne peut pas piloter
 * `wg` sur un poste Windows — il n'en a pas les droits — alors la console
 * **affichait** un bloc `[Peer]` à recopier à la main dans un fichier, hors du
 * produit, dans un bloc-notes. Cette étape a échoué quatre fois de suite sur
 * ce parc, et le seul symptôme était « Timeout après 5000ms » : la phrase qui
 * décrit un routeur éteint.
 *
 * Écrire un fichier, la console sait faire. Il ne reste alors qu'un
 * aller-retour dans l'application WireGuard — un geste, pas une manipulation.
 */

const CLE_A = 'a'.repeat(43) + '=';
const CLE_B = 'b'.repeat(43) + '=';

const INTERFACE = `# GeMikrot - bout serveur du tunnel
[Interface]
PrivateKey = ${'z'.repeat(43)}=
Address = 10.88.0.1/16
ListenPort = 41820
`;

function service(chemin: string) {
  const reglages: Record<string, string> = {
    WIREGUARD_ENDPOINT_HOST: '192.168.88.23',
    WIREGUARD_SERVER_PUBLIC_KEY: 'k'.repeat(43) + '=',
    WIREGUARD_CONFIG_PATH: chemin,
    WIREGUARD_MANAGED: 'false',
  };
  return new WireguardService({ get: (k: string) => reglages[k] } as never);
}

describe('le pair écrit dans le fichier du tunnel', () => {
  let dossier: string;
  let fichier: string;

  beforeEach(() => {
    dossier = mkdtempSync(join(tmpdir(), 'gemikrot-wg-'));
    fichier = join(dossier, 'wg0.conf');
    writeFileSync(fichier, INTERFACE, 'utf8');
  });

  afterEach(() => rmSync(dossier, { recursive: true, force: true }));

  it('ajoute le bloc, et le dit', async () => {
    const r = await service(fichier).addPeer(
      { publicKey: CLE_A, tunnelAddress: '10.88.0.2' },
      'hAP',
    );

    expect(r.ecritDansLeFichier).toBe(true);
    // `applied` reste faux, et c'est exact : le fichier est juste, le tunnel
    // qui tourne ne le sait pas encore.
    expect(r.applied).toBe(false);

    const contenu = readFileSync(fichier, 'utf8');
    expect(contenu).toContain(`PublicKey = ${CLE_A}`);
    expect(contenu).toContain('AllowedIPs = 10.88.0.2/32');
    expect(contenu).toContain('hAP');
    // L'interface survit intacte : la clé privée du serveur est dedans.
    expect(contenu).toContain('PrivateKey = ');
    expect(contenu).toContain('ListenPort = 41820');
  });

  it('remplace le pair d’un routeur reraccordé, au lieu d’empiler', async () => {
    // Un routeur qui repasse arrive avec une nouvelle clé. Empiler les blocs
    // laisserait des pairs morts que WireGuard accepte sans broncher, et dont
    // on ne saurait plus lequel est vivant — c'est exactement ce qui s'est
    // passé le 24/09/2026, à la main, avec trois clés pour un seul appareil.
    const s = service(fichier);
    await s.addPeer({ publicKey: CLE_A, tunnelAddress: '10.88.0.2' }, 'hAP');
    await s.addPeer({ publicKey: CLE_B, tunnelAddress: '10.88.0.2' }, 'hAP');

    const contenu = readFileSync(fichier, 'utf8');
    expect(contenu).toContain(CLE_B);
    expect(contenu).not.toContain(CLE_A);
    expect(contenu.match(/\[Peer\]/g)).toHaveLength(1);
  });

  it('remplace aussi quand c’est l’adresse qui se répète', async () => {
    // Même appareil, adresse réattribuée : deux pairs sur la même adresse ne
    // font pas tomber le tunnel, ils livrent les paquets au hasard — ce qui
    // est bien pire, parce que ça marche une fois sur deux.
    const s = service(fichier);
    await s.addPeer({ publicKey: CLE_A, tunnelAddress: '10.88.0.2' }, 'hAP');
    await s.addPeer({ publicKey: CLE_A, tunnelAddress: '10.88.0.5' }, 'hAP');

    const contenu = readFileSync(fichier, 'utf8');
    expect(contenu).toContain('10.88.0.5/32');
    expect(contenu).not.toContain('10.88.0.2/32');
    expect(contenu.match(/\[Peer\]/g)).toHaveLength(1);
  });

  it('garde les autres routeurs', async () => {
    const s = service(fichier);
    await s.addPeer({ publicKey: CLE_A, tunnelAddress: '10.88.0.2' }, 'hAP Betania');
    await s.addPeer({ publicKey: CLE_B, tunnelAddress: '10.88.0.3' }, 'hAP Sanfily');

    const contenu = readFileSync(fichier, 'utf8');
    expect(contenu.match(/\[Peer\]/g)).toHaveLength(2);
    expect(contenu).toContain('hAP Betania');
    expect(contenu).toContain('hAP Sanfily');
  });

  it('ne fait pas échouer un raccordement réussi quand le fichier manque', async () => {
    // Un fichier absent, en lecture seule ou tenu par un autre programme est
    // un ennui d'exploitation. Le routeur, lui, est bel et bien raccordé : le
    // perdre pour ça obligerait à tout recommencer sur place.
    const r = await service(join(dossier, 'nulle-part', 'wg0.conf')).addPeer(
      { publicKey: CLE_A, tunnelAddress: '10.88.0.2' },
      'hAP',
    );

    expect(r.ecritDansLeFichier).toBe(false);
    // Et la consigne manuelle revient, puisqu'elle redevient nécessaire.
    expect(r.command).toContain(`wg set wg0 peer ${CLE_A} allowed-ips 10.88.0.2/32`);
  });

  it('ne touche à rien quand aucun chemin n’est réglé', async () => {
    const r = await service('').addPeer({ publicKey: CLE_A, tunnelAddress: '10.88.0.2' }, 'hAP');

    expect(r.ecritDansLeFichier).toBe(false);
    expect(readFileSync(fichier, 'utf8')).toBe(INTERFACE);
  });
});
