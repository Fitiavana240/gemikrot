import { describe, expect, it } from 'vitest';
import { agrégerConsommation, type SessionÀCompter } from './consommation.util.js';

/**
 * Le découpage se fait dans le fuseau du routeur, jamais dans celui du serveur.
 *
 * Les sessions portent des dates **sans fuseau** : `"2026-09-26 14:48:58"`, à
 * lire dans l'heure du routeur. Le hAP de Toliara tourne en `+03:00`, le
 * serveur en UTC. Découper la journée avec l'heure du serveur ferait tomber
 * **trois heures de sessions dans la mauvaise journée, chaque nuit** — tout
 * ce qui se passe entre minuit et trois heures là-bas serait compté la veille.
 *
 * Ces épreuves posent des dates locales au routeur et un instant de référence
 * en UTC explicite : elles doivent dire la même chose ici et sur une machine
 * d'intégration.
 */

const TOLIARA = '+03:00';

/** 26/09 à 14 h UTC, soit 17 h à Toliara — un jeudi. */
const MAINTENANT = new Date('2026-09-26T11:00:00Z');

const session = (startTime: string, octets: number, username = 'H001'): SessionÀCompter => ({
  username,
  startTime,
  bytesIn: octets,
  bytesOut: 0,
});

describe('la consommation par tranche', () => {
  it('range une session du petit matin dans le bon jour', () => {
    // 01 h 30 à Toliara le 26 : c'est aujourd'hui là-bas, mais la veille à
    // 22 h 30 en UTC. C'est exactement la session que le découpage serveur
    // comptait dans le mauvais jour.
    const r = agrégerConsommation([session('2026-09-26 01:30:00', 1000)], TOLIARA, MAINTENANT);

    expect(r.jour.sessions).toBe(1);
    expect(r.jour.octets).toBe(1000);
  });

  it('exclut la veille au soir', () => {
    // 23 h 30 le 25 à Toliara : hier, et rien d'autre.
    const r = agrégerConsommation([session('2026-09-25 23:30:00', 1000)], TOLIARA, MAINTENANT);

    expect(r.jour.sessions).toBe(0);
    expect(r.semaine.sessions).toBe(1);
    expect(r.mois.sessions).toBe(1);
  });

  it('emboîte les tranches : le jour compte aussi dans la semaine et le mois', () => {
    const r = agrégerConsommation([session('2026-09-26 10:00:00', 500)], TOLIARA, MAINTENANT);

    expect(r.jour.octets).toBe(500);
    expect(r.semaine.octets).toBe(500);
    expect(r.mois.octets).toBe(500);
  });

  it('coupe la semaine au lundi, et le mois au premier', () => {
    // Le 26/09/2026 est un samedi ; la semaine ISO commence le lundi 21.
    const r = agrégerConsommation(
      [
        session('2026-09-21 08:00:00', 10), // lundi : dans la semaine
        session('2026-09-20 08:00:00', 20), // dimanche : hors semaine, dans le mois
        session('2026-08-31 08:00:00', 40), // mois précédent : hors tout
      ],
      TOLIARA,
      MAINTENANT,
    );

    expect(r.semaine.octets).toBe(10);
    expect(r.mois.octets).toBe(30);
  });

  it('additionne les deux sens', () => {
    const r = agrégerConsommation(
      [{ username: 'H001', startTime: '2026-09-26 10:00:00', bytesIn: 300, bytesOut: 200 }],
      TOLIARA,
      MAINTENANT,
    );

    expect(r.jour.octets).toBe(500);
  });

  it('classe les comptes du plus gros au plus petit, sur le mois', () => {
    const r = agrégerConsommation(
      [
        session('2026-09-26 10:00:00', 100, 'petit'),
        session('2026-09-20 10:00:00', 900, 'gros'),
        session('2026-09-26 11:00:00', 50, 'petit'),
      ],
      TOLIARA,
      MAINTENANT,
    );

    expect(r.parCompte.map((c) => c.username)).toEqual(['gros', 'petit']);
    expect(r.parCompte[1]).toEqual({ username: 'petit', octets: 150, sessions: 2 });
  });

  it('ne range nulle part une session sans date lisible, et le dit', () => {
    // La ranger « aujourd'hui » gonflerait le chiffre du jour d'un montant
    // que personne ne pourrait expliquer ; la ranger au mois ferait mentir le
    // total. Le compte affiché à côté est la seule réponse honnête.
    const r = agrégerConsommation(
      [session('2026-09-26 10:00:00', 100), session('', 9999), session('unlimited', 9999)],
      TOLIARA,
      MAINTENANT,
    );

    expect(r.sessionsLues).toBe(3);
    expect(r.sessionsDatées).toBe(1);
    expect(r.mois.octets).toBe(100);
  });

  it('donne un résultat différent selon le fuseau, et c’est tout le sujet', () => {
    const petitMatin = [session('2026-09-26 01:30:00', 1000)];

    // À Toliara : aujourd'hui. Lu en UTC : la même chaîne devient 01 h 30 UTC,
    // soit toujours aujourd'hui — mais l'instant de référence, lui, se
    // déplace. Ce qui compte est que les deux découpages ne coïncident pas.
    const àToliara = agrégerConsommation(petitMatin, TOLIARA, MAINTENANT);
    const enUtc = agrégerConsommation(
      [session('2026-09-25 23:30:00', 1000)],
      '+00:00',
      MAINTENANT,
    );

    expect(àToliara.jour.sessions).toBe(1);
    expect(enUtc.jour.sessions).toBe(0);
  });
});
