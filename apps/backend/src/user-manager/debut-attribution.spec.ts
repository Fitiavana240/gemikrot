import { describe, expect, it } from 'vitest';
import { debutAttribution } from './user-manager.service.js';

/**
 * Toutes les valeurs viennent du parc, relevées le 21/09/2026 sur le hAP.
 *
 * Le cas qui a dicté la conception : le forfait `TEST-1H` valait une heure
 * quand `test1h` l'a consommé, il vaut une minute aujourd'hui. Le routeur
 * fige l'échéance à l'attribution mais pas la durée — la soustraction seule
 * se trompait donc de 59 minutes sur les deux attributions de ce compte.
 */
const heure = (iso: string) => new Date(iso).getTime();

describe('debutAttribution', () => {
  it('préfère la session à la soustraction', () => {
    // `test1h`, attribution *1 : échéance 14:48:58, session démarrée à
    // 13:48:58. La validité du forfait vaut aujourd'hui une minute.
    const r = debutAttribution({
      fin: new Date('2026-09-17T14:48:58+03:00'),
      validitéSecondes: 60,
      sessionsTriées: [heure('2026-09-17T13:48:58+03:00')],
      échéancesDuCompte: [heure('2026-09-17T14:48:58+03:00')],
    });

    expect(r.mesuré).toBe(true);
    expect(r.date?.toISOString()).toBe(new Date('2026-09-17T13:48:58+03:00').toISOString());
  });

  it('borne la fenêtre par l’échéance précédente sur un compte racheté', () => {
    // `test1h` porte deux attributions : 14:48:58 puis 22:52:25. La seconde
    // doit commencer à 22:37:25, et non à la première connexion du compte.
    const sessions = [
      heure('2026-09-17T13:48:58+03:00'),
      heure('2026-09-17T14:21:36+03:00'),
      heure('2026-09-17T22:37:25+03:00'),
    ];
    const échéances = [
      heure('2026-09-17T14:48:58+03:00'),
      heure('2026-09-17T22:52:25+03:00'),
    ];

    const seconde = debutAttribution({
      fin: new Date('2026-09-17T22:52:25+03:00'),
      validitéSecondes: 60,
      sessionsTriées: sessions,
      échéancesDuCompte: échéances,
    });

    expect(seconde.mesuré).toBe(true);
    expect(seconde.date?.toISOString()).toBe(new Date('2026-09-17T22:37:25+03:00').toISOString());
  });

  it('retombe sur la soustraction quand le routeur n’a plus la session', () => {
    // Le journal des sessions est court : la plupart des comptes du parc
    // n'y figurent pas, et la soustraction est alors tout ce qu'on a.
    const r = debutAttribution({
      fin: new Date('2026-09-21T11:04:01+03:00'),
      validitéSecondes: 60,
      sessionsTriées: [],
      échéancesDuCompte: [heure('2026-09-21T11:04:01+03:00')],
    });

    expect(r.mesuré).toBe(false);
    expect(r.date?.toISOString()).toBe(new Date('2026-09-21T11:03:01+03:00').toISOString());
  });

  it('donne le même résultat par les deux chemins quand la durée n’a pas bougé', () => {
    // `TEST` : échéance 11:04:01, session 11:03:01, validité une minute.
    // La soustraction retrouve la mesure — c'est ce qui valide la déduction
    // comme repli, et non comme approximation commode.
    const commun = {
      fin: new Date('2026-09-21T11:04:01+03:00'),
      validitéSecondes: 60,
      échéancesDuCompte: [heure('2026-09-21T11:04:01+03:00')],
    };

    const mesuré = debutAttribution({
      ...commun,
      sessionsTriées: [heure('2026-09-21T11:03:01+03:00')],
    });
    const déduit = debutAttribution({ ...commun, sessionsTriées: [] });

    expect(mesuré.date?.toISOString()).toBe(déduit.date?.toISOString());
  });

  it('ne conclut rien sans échéance', () => {
    // `unlimited` et `not-yet-running` arrivent tous deux ici : il n'y a pas
    // de date de début à inventer pour un ticket qui n'a pas démarré.
    const r = debutAttribution({
      fin: null,
      validitéSecondes: 3600,
      sessionsTriées: [heure('2026-09-21T08:00:00+03:00')],
      échéancesDuCompte: [],
    });

    expect(r).toEqual({ date: null, mesuré: false });
  });

  it('ne conclut rien sans session ni validité connue', () => {
    // Forfait supprimé depuis : on ne sait pas de quoi soustraire, et
    // afficher l'échéance à la place ferait lire un début qui n'en est pas un.
    const r = debutAttribution({
      fin: new Date('2026-09-21T11:04:01+03:00'),
      validitéSecondes: null,
      sessionsTriées: [],
      échéancesDuCompte: [],
    });

    expect(r).toEqual({ date: null, mesuré: false });
  });

  it('ignore une session postérieure à l’échéance', () => {
    // Une reconnexion après expiration existe — le compte est resté, il a
    // juste été refusé. Elle ne peut pas être le début de la période écoulée.
    const r = debutAttribution({
      fin: new Date('2026-09-17T14:48:58+03:00'),
      validitéSecondes: 3600,
      sessionsTriées: [heure('2026-09-18T09:00:00+03:00')],
      échéancesDuCompte: [heure('2026-09-17T14:48:58+03:00')],
    });

    expect(r.mesuré).toBe(false);
    expect(r.date?.toISOString()).toBe(new Date('2026-09-17T13:48:58+03:00').toISOString());
  });
});
