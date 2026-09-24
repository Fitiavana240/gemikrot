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
    health = new RouterHealthService({ router: { update: async () => ({}) } } as never);
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

/**
 * << Un appel est laisse passer pour sonder le retour >> : la promesse etait
 * dans le commentaire, pas dans le code.
 *
 * `openUntil` etait efface par le premier appel a franchir la fin du repos,
 * et tous les suivants trouvaient la voie libre dans la meme seconde. Sur ce
 * parc, chaque fin de repos partait en quatre appels simultanes vers un
 * routeur mort, chacun payant ses seize secondes de delais -- vingt-quatre
 * echecs en cinq minutes sur un seul appareil, pour un lien qu'on savait
 * coupe des le troisieme.
 */
describe('une seule sonde a la fois', () => {
  let health: RouterHealthService;

  beforeEach(() => {
    health = new RouterHealthService({ router: { update: async () => ({}) } } as never);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('n’en laisse passer qu’un apres le repos', () => {
    failTimes(health, 3);
    vi.advanceTimersByTime(31_000);

    expect(health.autoriserAppel(ROUTER)).toBeNull();
    expect(health.autoriserAppel(ROUTER)).toContain('sonde en cours');
    expect(health.autoriserAppel(ROUTER)).toContain('sonde en cours');
  });

  it('rouvre pour un cycle quand la sonde echoue', () => {
    failTimes(health, 3);
    vi.advanceTimersByTime(31_000);
    health.autoriserAppel(ROUTER);

    health.recordFailure(ROUTER, new MikrotikTimeoutError('delai depasse'));

    expect(health.autoriserAppel(ROUTER)).toContain('nouvelle tentative dans');
  });

  it('referme tout quand la sonde reussit', () => {
    failTimes(health, 3);
    vi.advanceTimersByTime(31_000);
    health.autoriserAppel(ROUTER);

    health.recordSuccess(ROUTER);

    expect(health.autoriserAppel(ROUTER)).toBeNull();
    expect(health.autoriserAppel(ROUTER)).toBeNull();
  });

  it('en autorise une autre si la premiere n’a jamais rendu son verdict', () => {
    // Une sonde devrait toujours rendre son verdict. Un appel qui meurt
    // autrement fermerait le routeur pour toujours.
    failTimes(health, 3);
    vi.advanceTimersByTime(31_000);
    health.autoriserAppel(ROUTER);

    vi.advanceTimersByTime(26_000);

    expect(health.autoriserAppel(ROUTER)).toBeNull();
  });

  it('ne prend pas la place de sonde quand on ne fait que demander', () => {
    // La file d'operations differees demande << ce routeur repond-il ? >>
    // sans intention d'appeler. Prendre la place en passant la laisserait
    // tenue par personne, et fermerait le routeur jusqu'a son expiration.
    failTimes(health, 3);
    vi.advanceTimersByTime(31_000);

    expect(health.blockedReason(ROUTER)).toBeNull();
    expect(health.blockedReason(ROUTER)).toBeNull();
    expect(health.autoriserAppel(ROUTER)).toBeNull();
  });

  it('dit qu’une sonde est en cours plutot que de se taire', () => {
    failTimes(health, 3);
    vi.advanceTimersByTime(31_000);
    health.autoriserAppel(ROUTER);

    expect(health.blockedReason(ROUTER)).toContain('sonde en cours');
  });
});
