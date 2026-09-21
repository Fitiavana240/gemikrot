import { describe, expect, it } from 'vitest';
import { etatDe } from './abonnement-plateforme.service.js';

const jours = (n: number) => new Date(Date.now() + n * 86_400_000);

describe('etatDe', () => {
  it('ne bloque rien sans échéance', () => {
    // C'est le cas de tout exploitant qui n'a pas encore de contrat. Un
    // champ resté vide ne doit jamais fermer une console.
    expect(etatDe(null, null)).toEqual({ etat: 'sans-abonnement', joursRestants: null });
  });

  it('compte les jours restants avant l’échéance', () => {
    const { etat, joursRestants } = etatDe(jours(10), jours(24));

    expect(etat).toBe('a-jour');
    expect(joursRestants).toBe(10);
  });

  it('laisse la tolérance courir après l’échéance', () => {
    // Une console qui se ferme le jour même d'un retard de virement ferait
    // perdre des ventes pour rien.
    const { etat, joursRestants } = etatDe(jours(-3), jours(11));

    expect(etat).toBe('en-tolerance');
    expect(joursRestants).toBe(11);
  });

  it('bloque une fois la tolérance passée', () => {
    expect(etatDe(jours(-30), jours(-16)).etat).toBe('expire');
  });

  it('déduit une tolérance de quinze jours quand elle n’est pas posée', () => {
    // Une ligne d'avant l'ajout du champ ne doit pas se retrouver bloquée le
    // lendemain de son échéance faute de tolérance enregistrée.
    expect(etatDe(jours(-5), null).etat).toBe('en-tolerance');
    expect(etatDe(jours(-20), null).etat).toBe('expire');
  });

  it('traite l’échéance du jour comme encore à jour', () => {
    // La borne se joue sur une seconde : la franchir dans le mauvais sens
    // couperait la vente le matin du jour payé.
    const dansUneHeure = new Date(Date.now() + 3_600_000);

    expect(etatDe(dansUneHeure, null).etat).toBe('a-jour');
  });
});
