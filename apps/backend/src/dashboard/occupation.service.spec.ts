import { describe, expect, it } from 'vitest';
import { plafondDeClients, profilHoraire } from './occupation.service.js';

/** Un intervalle écrit lisiblement : `h(18, 40)` → aujourd'hui 18 h 40. */
const h = (heure: number, minute = 0, jour = 21) => new Date(2026, 8, jour, heure, minute);

describe('profilHoraire', () => {
  it('compte une session dans toutes les heures qu’elle traverse', () => {
    // 18 h 40 → 20 h 10 occupe le réseau à 18, 19 et 20 h. Ne la compter
    // qu'à son heure de départ ferait disparaître les longues sessions,
    // qui sont précisément celles qui saturent.
    const { parHeure } = profilHoraire([{ début: h(18, 40), fin: h(20, 10) }], h(23));

    expect(parHeure[18].max).toBe(1);
    expect(parHeure[19].max).toBe(1);
    expect(parHeure[20].max).toBe(1);
    expect(parHeure[17].max).toBe(0);
    expect(parHeure[21].max).toBe(0);
  });

  it('additionne les sessions simultanées', () => {
    const { parHeure, pointe } = profilHoraire(
      [
        { début: h(19, 5), fin: h(19, 50) },
        { début: h(19, 10), fin: h(19, 30) },
        { début: h(19, 0), fin: h(21, 0) },
      ],
      h(23),
    );

    expect(parHeure[19].max).toBe(3);
    expect(pointe?.sessions).toBe(3);
    expect(new Date(pointe!.quand).getHours()).toBe(19);
  });

  it('traverse minuit sans perdre la fin de la session', () => {
    const { parHeure, joursCouverts } = profilHoraire(
      [{ début: h(23, 30, 20), fin: h(1, 15, 21) }],
      h(12, 0, 21),
    );

    expect(parHeure[23].max).toBe(1);
    expect(parHeure[0].max).toBe(1);
    expect(parHeure[1].max).toBe(1);
    // Deux jours de calendrier touchés : la moyenne doit s'appuyer là-dessus.
    expect(joursCouverts).toBe(2);
  });

  it('divise la moyenne par les jours couverts, pas par les heures vues', () => {
    // Deux jours, une session de 19 h à 20 h le premier seulement. La
    // moyenne à 19 h vaut 0,5 : une heure creuse pèse zéro, elle ne
    // disparaît pas du calcul.
    const { parHeure } = profilHoraire(
      [
        { début: h(19, 0, 20), fin: h(20, 0, 20) },
        { début: h(9, 0, 21), fin: h(9, 30, 21) },
      ],
      h(12, 0, 21),
    );

    expect(parHeure[19].moyenne).toBe(0.5);
    expect(parHeure[19].max).toBe(1);
  });

  it('borne une session dont la fin est dans le futur', () => {
    // Une session en cours court « jusqu'à maintenant » : sans borne, elle
    // remplirait toutes les heures à venir de la journée.
    const { parHeure } = profilHoraire([{ début: h(8), fin: h(23) }], h(10, 30));

    expect(parHeure[10].max).toBe(1);
    expect(parHeure[11].max).toBe(0);
  });

  it('ne tourne pas indéfiniment sur une date aberrante', () => {
    // RouterOS rend `1970-01-01` pour un compte jamais connecté. Sans
    // garde-fou, la boucle horaire ferait un demi-million de tours.
    const { parHeure } = profilHoraire([{ début: new Date(0), fin: h(12) }], h(12));

    expect(parHeure).toHaveLength(24);
  });

  it('rend un profil vide sans session, plutôt que de refuser', () => {
    const { parHeure, pointe } = profilHoraire([], h(12));

    expect(parHeure.every((t) => t.max === 0 && t.moyenne === 0)).toBe(true);
    expect(pointe).toBeNull();
  });
});

describe('plafondDeClients', () => {
  /** Relevé sur le parc le 21/09/2026 : 245 adresses, 29 prises, 17 baux. */
  const BASSIN_DU_PARC = {
    id: '*2',
    name: 'pool-hotspot',
    ranges: '192.168.88.10-192.168.88.254',
    total: 245,
    used: 29,
    available: 216,
    byOwner: [
      { owner: 'DHCP', count: 17 },
      { owner: 'hotspot', count: 12 },
    ],
  };

  it('divise par les adresses réellement prises par client', () => {
    // 29 adresses pour 17 appareils, soit ~1,7 par client : le plafond est
    // de 143 clients, pas de 245. Compter les adresses donnerait un chiffre
    // trop optimiste de 70 %.
    expect(plafondDeClients([BASSIN_DU_PARC])).toBe(143);
  });

  it('retombe sur une adresse par client quand aucun bail n’est lu', () => {
    const vide = { ...BASSIN_DU_PARC, used: 0, byOwner: [] };
    expect(plafondDeClients([vide])).toBe(245);
  });

  it('ne conclut rien quand le routeur ne rend pas ses bassins', () => {
    // Mieux vaut pas de plafond qu'un plafond inventé, dont on déduirait un
    // taux d'occupation faux.
    expect(plafondDeClients([])).toBeNull();
  });
});
