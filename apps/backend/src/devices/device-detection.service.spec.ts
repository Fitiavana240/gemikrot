import { describe, expect, it, beforeEach } from 'vitest';
import { DeviceDetectionService } from './device-detection.service.js';

describe('DeviceDetectionService', () => {
  let service: DeviceDetectionService;

  beforeEach(() => {
    service = new DeviceDetectionService();
  });

  it('reconnaît un téléphone depuis son nom DHCP', () => {
    // Nom réellement observé sur le réseau WIFI-TATI.
    const result = service.detect({ macAddress: '6C:D7:1F:A2:5A:81', hostname: 'OPPO-A15-Pro' });

    expect(result.type).toBe('PHONE');
    expect(result.confidence).toBe('high');
  });

  it('reconnaît un ordinateur depuis le préfixe DESKTOP-', () => {
    expect(service.detect({ hostname: 'DESKTOP-4F2K1' }).type).toBe('COMPUTER');
  });

  it('reconnaît une TV connectée', () => {
    expect(service.detect({ hostname: 'Samsung-SmartTV' }).type).toBe('TV');
  });

  it('privilégie le commentaire du routeur et le dit explicitement', () => {
    // Cas réel : les TV du parc n'annoncent aucun nom DHCP, mais portent un
    // commentaire posé à la main sur l'ip-binding.
    const result = service.detect({
      macAddress: 'C0:8A:60:AB:61:75',
      hostname: null,
      comment: 'Smart TV Samsung - Client Dalia- abonnement manuel',
    });

    expect(result.type).toBe('TV');
    expect(result.source).toContain('commentaire routeur');
  });

  it('reste prudent quand aucun nom DHCP n\'est annoncé', () => {
    // Cas des TV Samsung du parc : contournement créé à la main, sans nom DHCP.
    const result = service.detect({ macAddress: 'C0:8A:60:AB:61:75', hostname: null });

    expect(result.type).toBe('OTHER');
    expect(result.confidence).toBe('low');
    expect(result.source).toContain('Samsung');
  });

  it('signale les appareils incapables d\'afficher le portail captif', () => {
    expect(service.requiresBypass('TV')).toBe(true);
    expect(service.requiresBypass('CAMERA')).toBe(true);
    expect(service.requiresBypass('PHONE')).toBe(false);
  });
});
