import { describe, expect, it, vi } from 'vitest';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';
import type { RouterOSClientConfig } from '@wifitati/mikrotik-service';

/**
 * Un routeur RouterOS présente toujours un certificat auto-signé.
 *
 * Le hAP n'a pas de nom public, et son certificat est fabriqué par le script
 * d'enrôlement avec sa propre autorité : **aucune autorité publique ne le
 * contresigne**. Exiger une chaîne de certification valide, c'est donc refuser
 * la connexion à tous les routeurs, toujours.
 *
 * C'est ce qui s'est passé. Le réglage valait `true` en production, et le
 * défaut ne se voyait d'aucun des endroits où on l'a cherché : le tunnel était
 * monté, `ping` répondait à 209 ms, et `curl -k` rendait un 401 depuis le
 * conteneur lui-même. La console, elle, n'avait qu'un mot — « injoignable » —
 * le même que pour un routeur éteint. Deux jours, le 25/09/2026.
 *
 * Ce que ces tests tiennent : sans empreinte, la fabrique n'exige pas de
 * chaîne ; avec empreinte, elle l'exige, parce que c'est ainsi que le client
 * bascule sur l'épinglage.
 */

const ROUTEUR = {
  id: 'r1',
  label: 'hAP Betania',
  host: '192.168.88.1',
  restPort: 443,
  credentialsEncrypted: 'chiffre',
  tlsFingerprint: null as string | null,
  tunnelAddress: '10.88.0.2',
  tunnelPublicKey: 'cle-du-routeur',
  enrolledAt: new Date(),
};

function fabrique(routeur: typeof ROUTEUR) {
  const prisma = { scoped: { router: { findUnique: vi.fn(async () => routeur) } } } as never;
  const factory = new MikrotikClientFactory(
    prisma,
    { decrypt: () => ({ username: 'gemikrot-api', password: 'x' }) } as never,
    { autoriserAppel: () => null, recordSuccess: vi.fn(), recordFailure: vi.fn(), reset: vi.fn() } as never,
    { get: () => ({ tenantId: 't1', isSuperAdmin: false }) } as never,
  );
  const vues: RouterOSClientConfig[] = [];
  vi.spyOn(factory, 'buildFromConfig').mockImplementation((config) => {
    vues.push(config);
    return {} as never;
  });
  return { factory, vues };
}

describe('le certificat auto-signé du routeur', () => {
  it("n'exige aucune chaîne de certification quand la fiche ne porte pas d'empreinte", async () => {
    const { factory, vues } = fabrique({ ...ROUTEUR, tlsFingerprint: null });

    await factory.forRouter('r1');

    expect(vues).toHaveLength(1);
    // Le cœur du défaut. `true` ici, et le routeur devient injoignable pour
    // une raison qui n'a rien à voir avec le réseau.
    expect(vues[0].rejectUnauthorized).toBe(false);
    expect(vues[0].tlsFingerprint).toBeUndefined();
  });

  it("épingle l'empreinte quand la fiche en porte une", async () => {
    const empreinte = 'AA:BB:CC:DD';
    const { factory, vues } = fabrique({ ...ROUTEUR, tlsFingerprint: empreinte });

    await factory.forRouter('r1');

    expect(vues[0].tlsFingerprint).toBe(empreinte);
    // `true` **avec** une empreinte ne veut pas dire « valider la chaîne » :
    // le client construit alors un connecteur qui accepte l'auto-signé et
    // compare l'empreinte présentée. C'est la seule combinaison qui contrôle
    // vraiment quelque chose.
    expect(vues[0].rejectUnauthorized).toBe(true);
  });

  it('passe par le tunnel, et non par l’adresse du réseau local', async () => {
    const { factory, vues } = fabrique(ROUTEUR);

    await factory.forRouter('r1');

    expect(vues[0].baseUrl).toBe('https://10.88.0.2:443');
  });
});
