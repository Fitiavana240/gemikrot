import { describe, expect, it } from 'vitest';
import { champCsv, débutDeTranche } from './recettes.service.js';

describe('débutDeTranche', () => {
  it('ramène au lundi, pas au dimanche', () => {
    // Le 2026-09-21 est un lundi ; le 2026-09-27, le dimanche qui suit.
    // `getDay()` rend 0 le dimanche : une soustraction naïve le placerait
    // au début de la semaine suivante, et la recette du dimanche soir
    // basculerait dans la semaine d'après.
    const lundi = new Date(2026, 8, 21, 8, 0);
    const dimanche = new Date(2026, 8, 27, 22, 30);

    expect(débutDeTranche(lundi, 'semaine').getDate()).toBe(21);
    expect(débutDeTranche(dimanche, 'semaine').getDate()).toBe(21);
  });

  it('garde la vente de 22 h dans sa journée', () => {
    // En UTC, 22 h à Toliara (UTC+3) tombe la veille : le total du jour ne
    // correspondrait plus à la caisse du soir. Le découpage est donc local.
    const soir = new Date(2026, 8, 21, 22, 15);
    const tranche = débutDeTranche(soir, 'jour');

    expect(tranche.getDate()).toBe(21);
    expect(tranche.getHours()).toBe(0);
  });

  it('ramène au premier du mois', () => {
    expect(débutDeTranche(new Date(2026, 8, 30, 23, 59), 'mois').getDate()).toBe(1);
  });
});

describe('champCsv', () => {
  it('protège un champ qui porte le séparateur', () => {
    // Le point-virgule sépare : un commentaire qui en contient couperait la
    // ligne en deux colonnes et décalerait tout le reste du fichier.
    expect(champCsv('Rakoto; Jean')).toBe('"Rakoto; Jean"');
  });

  it('double les guillemets plutôt que de les perdre', () => {
    expect(champCsv('Ticket "1 mois"')).toBe('"Ticket ""1 mois"""');
  });

  it('protège un champ qui porte un retour à la ligne', () => {
    expect(champCsv('a\nb')).toBe('"a\nb"');
  });

  it('laisse tel quel ce qui n’a besoin de rien', () => {
    expect(champCsv('MVOLA')).toBe('MVOLA');
    expect(champCsv(1500)).toBe('1500');
  });

  it('rend une chaîne vide pour une valeur absente', () => {
    // Un ticket purgé à trente jours laisse son paiement sans code : la
    // colonne doit être vide, pas porter « null ».
    expect(champCsv(null)).toBe('');
    expect(champCsv(undefined)).toBe('');
  });
});
