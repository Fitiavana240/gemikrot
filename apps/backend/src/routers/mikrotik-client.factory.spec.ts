import { describe, expect, it } from 'vitest';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';

/**
 * Par quelle adresse la console joint un routeur.
 *
 * La colonne `tunnelAddress` existait, l'enrôlement la remplissait, et
 * **personne ne la lisait** : la fabrique composait toujours
 * `https://${host}`. L'accès à distance ne pouvait donc pas fonctionner,
 * quel que soit l'état du tunnel — une adresse de réseau local ne veut rien
 * dire depuis ailleurs, et le script d'enrôlement restreint par-dessus le
 * marché le service REST à la seule adresse du serveur.
 */
function routeur(champs: Partial<Record<string, unknown>>) {
  return {
    host: '192.168.88.1',
    tunnelAddress: null,
    enrolledAt: null,
    ...champs,
  } as never;
}

describe('MikrotikClientFactory.adresseDuRouteur', () => {
  it('passe par le tunnel quand le routeur est enrôlé', () => {
    const choix = MikrotikClientFactory.adresseDuRouteur(
      routeur({ tunnelAddress: '10.88.0.2', enrolledAt: new Date() }),
    );

    expect(choix).toEqual({ hôte: '10.88.0.2', parLeTunnel: true });
  });

  it("garde l'adresse locale tant qu'aucun enrôlement n'a abouti", () => {
    // Une adresse réservée pour une invitation jamais consommée ne doit pas
    // détourner les appels vers un tunnel qui n'existe pas : le routeur
    // deviendrait injoignable alors qu'il répond parfaitement en local.
    const choix = MikrotikClientFactory.adresseDuRouteur(
      routeur({ tunnelAddress: '10.88.0.7', enrolledAt: null }),
    );

    expect(choix).toEqual({ hôte: '192.168.88.1', parLeTunnel: false });
  });

  it("garde l'adresse locale quand l'enrôlement n'a pas laissé d'adresse", () => {
    const choix = MikrotikClientFactory.adresseDuRouteur(
      routeur({ tunnelAddress: null, enrolledAt: new Date() }),
    );

    expect(choix.hôte).toBe('192.168.88.1');
    expect(choix.parLeTunnel).toBe(false);
  });
});
