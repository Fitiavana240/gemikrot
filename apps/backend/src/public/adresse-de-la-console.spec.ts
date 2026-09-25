import { afterEach, describe, expect, it } from 'vitest';
import { estLaConsole } from './public.service.js';

/**
 * L'adresse de la console ne resout jamais vers un exploitant.
 *
 * Un visiteur anonyme sur une adresse qui designe un exploitant est renvoye
 * vers sa page de paiement. La regle est juste quand l'exploitant a son propre
 * domaine ; quand la console et le portail partagent la meme adresse, elle
 * **ferme la porte d'entree** -- l'exploitant se deconnecte et retombe sur la
 * vitrine de ses propres clients, sans plus aucun moyen d'atteindre sa
 * console depuis la racine.
 *
 * Et cela arrive tout seul : l'adresse publique de la console est proposee
 * comme page de paiement des qu'elle existe, parce que c'est la seule qui
 * marche de partout. L'exploitant la choisit, et se ferme la porte sans rien
 * avoir fait de travers. Constate le 25/09/2026.
 */

const INITIAL = process.env.PUBLIC_BASE_URL;
afterEach(() => {
  if (INITIAL === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = INITIAL;
});

describe("l'adresse de la console", () => {
  it('se reconnait, avec ou sans le chemin de l’API', () => {
    process.env.PUBLIC_BASE_URL = 'https://gemikrot.duckdns.org/api';

    expect(estLaConsole('gemikrot.duckdns.org')).toBe(true);
    // Le port arrive avec l'en-tete `Host` et ne change pas le site.
    expect(estLaConsole('gemikrot.duckdns.org:443')).toBe(true);
    expect(estLaConsole('GEMIKROT.DUCKDNS.ORG')).toBe(true);
  });

  it('ne se confond pas avec le domaine d’un exploitant', () => {
    process.env.PUBLIC_BASE_URL = 'https://gemikrot.duckdns.org/api';

    expect(estLaConsole('wifitati.net')).toBe(false);
    expect(estLaConsole('autre.duckdns.org')).toBe(false);
  });

  it('ne bloque rien quand le serveur n’a pas d’adresse publique', () => {
    delete process.env.PUBLIC_BASE_URL;

    // Un montage de labo n'a pas de `PUBLIC_BASE_URL` : la resolution par
    // domaine doit continuer de marcher comme avant.
    expect(estLaConsole('wifitati.net')).toBe(false);
  });
});
