import { describe, expect, it } from 'vitest';
import { parseRouterTime } from './router-time.util.js';

describe('parseRouterTime', () => {
  it('lit une échéance dans le fuseau du routeur, pas dans celui du serveur', () => {
    // Valeur relevée sur le hAP, dont l'horloge annonce `gmt-offset +03:00`.
    const parsed = parseRouterTime('2026-09-17 14:48:58', '+03:00');

    expect(parsed?.toISOString()).toBe('2026-09-17T11:48:58.000Z');
  });

  it('décale bien dans l\'autre sens pour un fuseau négatif', () => {
    const parsed = parseRouterTime('2026-09-17 14:48:58', '-05:00');

    expect(parsed?.toISOString()).toBe('2026-09-17T19:48:58.000Z');
  });

  it('accepte la notation compacte de l\'offset', () => {
    expect(parseRouterTime('2026-09-17 14:48:58', '+0300')?.toISOString()).toBe(
      '2026-09-17T11:48:58.000Z',
    );
  });

  it('retombe sur UTC quand le routeur ne donne pas d\'offset lisible', () => {
    expect(parseRouterTime('2026-09-17 14:48:58', '')?.toISOString()).toBe(
      '2026-09-17T14:48:58.000Z',
    );
  });

  it('ne fabrique pas de date pour les valeurs sentinelles', () => {
    // Un profil `first-auth` avant la première connexion, et un profil sans
    // échéance : deux absences d'échéance, pas deux dates invalides.
    expect(parseRouterTime('not-yet-running', '+03:00')).toBeNull();
    expect(parseRouterTime('unlimited', '+03:00')).toBeNull();
    expect(parseRouterTime(null, '+03:00')).toBeNull();
    expect(parseRouterTime('n\'importe quoi', '+03:00')).toBeNull();
  });
});
