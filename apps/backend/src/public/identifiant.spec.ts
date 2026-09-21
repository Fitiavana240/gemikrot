import { describe, expect, it } from 'vitest';
import { identifiantDepuisNom, identifiantUtilisable, mêmeIdentifiant } from './identifiant.js';

describe('identifiantDepuisNom', () => {
  it('recolle les espaces avec un tiret', () => {
    expect(identifiantDepuisNom('Rakoto Jean')).toBe('Rakoto-Jean');
  });

  it('retire les accents plutôt que de les garder', () => {
    // Le portail captif se saisit souvent depuis un clavier qui ne les
    // porte pas : un « é » retapé « e » ne se connecterait pas.
    expect(identifiantDepuisNom('Hervé Razafy')).toBe('Herve-Razafy');
    expect(identifiantDepuisNom('Noëlle')).toBe('Noelle');
  });

  it('garde la casse, qui aide à se relire', () => {
    expect(identifiantDepuisNom('RANDRIA Paul')).toBe('RANDRIA-Paul');
  });

  it('ne laisse pas de tiret au bord', () => {
    expect(identifiantDepuisNom('  Jean  ')).toBe('Jean');
    expect(identifiantDepuisNom('« Jean »')).toBe('Jean');
    expect(identifiantDepuisNom('Jean-')).toBe('Jean');
  });

  it('ne laisse pas de tiret après la coupe en longueur', () => {
    // 24 caractères tombant pile sur un tiret donnerait « …Rasoa- », qu'on
    // retaperait de travers une fois sur deux.
    const long = identifiantDepuisNom('Jean Baptiste Andriam Rasoanaivo');
    expect(long.endsWith('-')).toBe(false);
    expect(long.length).toBeLessThanOrEqual(24);
  });

  it('rend une chaîne vide quand il ne reste rien de saisissable', () => {
    expect(identifiantDepuisNom('???')).toBe('');
    expect(identifiantDepuisNom('   ')).toBe('');
  });
});

describe('identifiantUtilisable', () => {
  it('refuse ce qui est trop court pour être distinctif', () => {
    expect(identifiantUtilisable('Jo')).toBe(false);
    expect(identifiantUtilisable('Joe')).toBe(true);
  });

  it('exige au moins une lettre', () => {
    // « 2024 » se confondrait avec une référence, et deux clients le
    // choisiraient le même jour.
    expect(identifiantUtilisable('2024')).toBe(false);
    expect(identifiantUtilisable('Rak2024')).toBe(true);
  });

  it('refuse le vide laissé par un nom sans caractère saisissable', () => {
    expect(identifiantUtilisable('')).toBe(false);
  });
});

describe('mêmeIdentifiant', () => {
  it('ignore la casse', () => {
    // Sans cela, deux clients croiraient chacun posséder « Rakoto ».
    expect(mêmeIdentifiant('Rakoto', 'rakoto')).toBe(true);
    expect(mêmeIdentifiant('Rakoto', 'Rakotu')).toBe(false);
  });
});
