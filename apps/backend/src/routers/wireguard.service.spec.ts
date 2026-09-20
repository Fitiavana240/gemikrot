import { describe, expect, it } from 'vitest';
import { WireguardService } from './wireguard.service.js';

/**
 * Le routeur appelle l'adresse du serveur : privée, il ne la joint que depuis
 * le même réseau. L'échec est alors **muet** — WireGuard n'a personne à qui
 * parler, les octets sortants montent, les entrants restent à zéro, et rien
 * ne dit pourquoi. Ce diagnostic a coûté une heure sur ce projet, sur ce
 * routeur, parce que le bail DHCP du serveur avait changé de .47 à .135.
 */
function service(endpointHost: string): WireguardService {
  const config = { get: (clé: string) => (clé === 'WIREGUARD_ENDPOINT_HOST' ? endpointHost : undefined) };
  return new WireguardService(config as never);
}

describe('WireguardService.endpointPrive', () => {
  it('reconnaît les plages privées, celles qui piègent', () => {
    // 192.168.88.135 est exactement l'adresse qui a échoué ici.
    for (const hôte of ['192.168.88.135', '10.0.0.1', '172.16.4.2', '172.31.255.254', '127.0.0.1']) {
      expect(service(hôte).endpointPrive, hôte).toBe(true);
    }
  });

  it('reconnaît le lien-local, que rend une machine sans bail DHCP', () => {
    expect(service('169.254.10.3').endpointPrive).toBe(true);
  });

  it('laisse passer une adresse publique', () => {
    for (const hôte of ['41.188.10.5', '8.8.8.8', '172.32.0.1', '11.0.0.1']) {
      expect(service(hôte).endpointPrive, hôte).toBe(false);
    }
  });

  it('présume un nom de domaine public sans le résoudre', () => {
    // Résoudre depuis le serveur ne dirait rien de ce que verra le routeur,
    // et se tromper dans ce sens n'omet qu'un avertissement.
    expect(service('vpn.gemikrot.mg').endpointPrive).toBe(false);
  });

  it("ne crie pas sur une configuration absente", () => {
    // L'absence d'adresse est déjà signalée par `missingConfiguration` :
    // deux messages pour un seul manque en noieraient le sens.
    expect(service('').endpointPrive).toBe(false);
    expect(service('   ').endpointPrive).toBe(false);
  });
});
