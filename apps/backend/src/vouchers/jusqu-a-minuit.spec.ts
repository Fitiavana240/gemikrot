import { describe, expect, it } from 'vitest';
import {
  offsetEnMinutes,
  PLANCHER_SECONDES,
  secondesJusquAMinuit,
  suffixeMinuit,
} from './jusqu-a-minuit.util.js';

/**
 * Minuit est celui du routeur, jamais celui du serveur.
 *
 * Le hAP de Toliara tourne en `+03:00`, le serveur en France. Prendre l'heure
 * du serveur ferait mourir les tickets trois heures trop tôt, **chaque
 * nuit**, sans que rien ne le signale — exactement le defaut que
 * `parseRouterTime` corrige deja pour les echeances.
 *
 * Les instants sont donnes en UTC explicite : ces epreuves doivent dire la
 * meme chose sur un poste a Toliara et sur une machine d'integration en UTC.
 */

/** 17 h 00 a Toliara (+03:00) est 14 h 00 UTC. */
const à = (iso: string) => new Date(iso);

describe('secondes jusqu’à minuit', () => {
  it('compte dans le fuseau du routeur, pas dans celui du serveur', () => {
    // 14 h UTC = 17 h a Toliara : il reste sept heures.
    expect(secondesJusquAMinuit(à('2026-09-26T14:00:00Z'), '+03:00')).toBe(7 * 3600);

    // Le meme instant, lu en UTC, donnerait dix heures. C'est l'erreur qu'on
    // evite : trois heures de trop, tous les jours.
    expect(secondesJusquAMinuit(à('2026-09-26T14:00:00Z'), '+00:00')).toBe(10 * 3600);
  });

  it('accepte les écritures d’offset que RouterOS emploie', () => {
    expect(offsetEnMinutes('+03:00')).toBe(180);
    expect(offsetEnMinutes('+0300')).toBe(180);
    expect(offsetEnMinutes('03:00')).toBe(180);
    expect(offsetEnMinutes('-04:00')).toBe(-240);
    expect(offsetEnMinutes('+05:30')).toBe(330);
    expect(offsetEnMinutes('UTC')).toBe(0);
  });

  it('refuse de tirer plutôt que de poser une durée fausse', () => {
    // Un offset illisible ne doit pas retomber sur UTC en silence : ce serait
    // vendre des tickets qui meurent a la mauvaise heure.
    expect(secondesJusquAMinuit(à('2026-09-26T14:00:00Z'), 'n’importe quoi')).toBeNull();
    expect(secondesJusquAMinuit(à('2026-09-26T14:00:00Z'), '')).toBeNull();
    expect(secondesJusquAMinuit(à('2026-09-26T14:00:00Z'), null)).toBeNull();
  });

  it('donne la journée suivante quand il ne reste presque rien', () => {
    // 23 h 59 a Toliara : une minute. Le client paie, se connecte, et perd
    // son acces avant d'avoir ouvert une page.
    const reste = secondesJusquAMinuit(à('2026-09-26T20:59:00Z'), '+03:00');
    expect(reste).toBe(60 + 24 * 3600);
    expect(reste!).toBeGreaterThan(PLANCHER_SECONDES);
  });

  it('ne bascule pas juste au-dessus du plancher', () => {
    // 23 h 29 a Toliara : trente et une minutes, au-dessus du plancher.
    expect(secondesJusquAMinuit(à('2026-09-26T20:29:00Z'), '+03:00')).toBe(31 * 60);
  });

  it('rend une journée entière à minuit pile', () => {
    // 21 h UTC = minuit a Toliara : le jour vient de basculer.
    expect(secondesJusquAMinuit(à('2026-09-26T21:00:00Z'), '+03:00')).toBe(24 * 3600);
  });

  it('tient sur un offset négatif', () => {
    // 14 h UTC = 10 h a UTC-4 : quatorze heures restent.
    expect(secondesJusquAMinuit(à('2026-09-26T14:00:00Z'), '-04:00')).toBe(14 * 3600);
  });
});

describe('le suffixe du profil', () => {
  it('arrondit à l’heure supérieure, pour ne jamais vendre trop court', () => {
    expect(suffixeMinuit(7 * 3600)).toBe('minuit-7h');
    // Six heures et une minute : sept heures de profil. Quelques minutes de
    // trop valent mieux qu'un acces qui meurt avant minuit.
    expect(suffixeMinuit(6 * 3600 + 60)).toBe('minuit-7h');
    expect(suffixeMinuit(60)).toBe('minuit-1h');
  });

  it('borne le nombre de profils que le routeur portera', () => {
    // Au plus vingt-cinq valeurs distinctes sur une journee entiere, et c'est
    // ce qui rend l'approche tenable : a la minute pres, chaque tirage
    // creerait un profil de plus.
    const vus = new Set<string>();
    for (let s = 60; s <= 48 * 3600; s += 60) vus.add(suffixeMinuit(s));
    expect(vus.size).toBeLessThanOrEqual(48);
  });
});
