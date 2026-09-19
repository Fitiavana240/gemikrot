import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import {
  MikrotikAuthError,
  MikrotikConflictError,
  MikrotikTimeoutError,
} from '@wifitati/mikrotik-service';
import { RouterHealthService } from './router-health.service.js';

const ROUTER = 'routeur-1';

function failTimes(health: RouterHealthService, count: number): void {
  for (let i = 0; i < count; i += 1) {
    health.recordFailure(ROUTER, new MikrotikTimeoutError('délai dépassé'));
  }
}

describe('RouterHealthService', () => {
  let health: RouterHealthService;

  beforeEach(() => {
    health = new RouterHealthService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('laisse passer tant que les échecs ne sont pas concluants', () => {
    // Deux échecs peuvent être un aléa de lien ; on ne condamne pas encore.
    failTimes(health, 2);

    expect(health.blockedReason(ROUTER)).toBeNull();
    expect(health.get(ROUTER).state).toBe('INJOIGNABLE');
  });

  it('suspend les appels au troisième échec réseau consécutif', () => {
    failTimes(health, 3);

    const reason = health.blockedReason(ROUTER);
    expect(reason).toContain('nouvelle tentative dans');
    expect(health.get(ROUTER).openUntil).not.toBeNull();
  });

  it('laisse repasser un appel après le repos, pour sonder le retour', () => {
    vi.useFakeTimers();
    failTimes(health, 3);
    expect(health.blockedReason(ROUTER)).not.toBeNull();

    vi.advanceTimersByTime(31_000);

    expect(health.blockedReason(ROUTER)).toBeNull();
  });

  it('referme le disjoncteur au premier succès', () => {
    failTimes(health, 5);
    health.recordSuccess(ROUTER);

    expect(health.blockedReason(ROUTER)).toBeNull();
    expect(health.get(ROUTER).state).toBe('JOIGNABLE');
    expect(health.get(ROUTER).consecutiveFailures).toBe(0);
  });

  describe("ce qui ne doit pas ouvrir le disjoncteur", () => {
    it('un refus d\'authentification', () => {
      // Le routeur a répondu : il est joignable. Couper l'accès pour un mot
      // de passe erroné masquerait la vraie cause et empêcherait de la
      // corriger depuis la console.
      for (let i = 0; i < 5; i += 1) health.recordFailure(ROUTER, new MikrotikAuthError());

      expect(health.blockedReason(ROUTER)).toBeNull();
      expect(health.get(ROUTER).state).toBe('REPOND_MAL');
    });

    it('un conflit métier', () => {
      for (let i = 0; i < 5; i += 1) {
        health.recordFailure(ROUTER, new MikrotikConflictError('existe déjà'));
      }

      expect(health.blockedReason(ROUTER)).toBeNull();
      expect(health.get(ROUTER).state).toBe('REPOND_MAL');
    });
  });

  it('distingue chaque routeur', () => {
    failTimes(health, 3);

    expect(health.blockedReason(ROUTER)).not.toBeNull();
    expect(health.blockedReason('routeur-2')).toBeNull();
  });

  it('repart de zéro quand la configuration du routeur change', () => {
    failTimes(health, 3);
    health.reset(ROUTER);

    expect(health.blockedReason(ROUTER)).toBeNull();
    expect(health.get(ROUTER).state).toBe('INCONNU');
  });
});
