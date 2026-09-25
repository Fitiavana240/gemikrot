import { describe, expect, it } from 'vitest';
import { generateVoucherCode } from './voucher-code.util.js';

/**
 * La forme du ticket imprime : identifiant, mot de passe, et leur longueur.
 *
 * L'alphabet ecarte les caracteres qui se confondent a l'oral et a l'ecran --
 * ni `0/O`, ni `1/I/l`. Ce n'est pas un detail : un client de Toliara retape
 * ce code a la main, sur un telephone, souvent au soleil. Un `O` lu `0` est
 * un ticket vendu qui ne marche pas, et un vendeur qu'on rappelle.
 */
describe('la forme d’un code de ticket', () => {
  it('respecte la longueur demandée, prefixe non compris', () => {
    expect(generateVoucherCode(6, 'H')).toHaveLength(7);
    expect(generateVoucherCode(4, 'TATI-')).toHaveLength(9);
    expect(generateVoucherCode(4)).toHaveLength(4);
  });

  it('n’emploie jamais un caractère qui se confond', () => {
    // Mille tirages : assez pour qu'un caractere interdit sorte s'il est dans
    // l'alphabet, et assez rapide pour tourner a chaque fois.
    const interdits = /[0O1Il]/;
    for (let i = 0; i < 1000; i += 1) {
      expect(generateVoucherCode(12)).not.toMatch(interdits);
    }
  });

  it('garde le prefixe tel quel, sans le normaliser', () => {
    // L'exploitant imprime ce qu'il a tape : changer sa casse le surprendrait
    // au moment ou il compare le papier a l'ecran.
    expect(generateVoucherCode(4, 'tati-')).toMatch(/^tati-/);
    expect(generateVoucherCode(4, 'H')).toMatch(/^H/);
  });

  it('tire des codes distincts', () => {
    // Huit caracteres sur trente-deux : la collision existe, et la creation
    // la rattrape en rejouant. Ce test dit seulement que le tirage n'est pas
    // constant -- un generateur fige passerait tout le reste.
    const vus = new Set<string>();
    for (let i = 0; i < 200; i += 1) vus.add(generateVoucherCode(8));
    expect(vus.size).toBe(200);
  });
});
