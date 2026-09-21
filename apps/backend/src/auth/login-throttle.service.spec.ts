import { describe, expect, it } from 'vitest';
import { LoginThrottleService } from './login-throttle.service.js';

/**
 * Le freinage des essais de mot de passe.
 *
 * Mesuré avant de l'écrire : douze tentatives de suite rendaient douze 401.
 * Ces tests fixent les deux propriétés qui empêchent le remède d'être pire
 * que le mal — une réussite efface l'ardoise, et un compte ne peut pas être
 * verrouillé depuis ailleurs.
 */
function échouer(t: LoginThrottleService, email: string, ip: string, fois: number) {
  for (let i = 0; i < fois; i += 1) {
    t.verifier(email, ip);
    t.echec(email, ip);
  }
}

describe('LoginThrottleService', () => {
  it('laisse passer dix échecs puis bloque le onzième', () => {
    const t = new LoginThrottleService();
    expect(() => échouer(t, 'a@example.test', '10.0.0.1', 10)).not.toThrow();
    expect(() => t.verifier('a@example.test', '10.0.0.1')).toThrow(/Trop de tentatives/);
  });

  it('efface l’ardoise après une connexion réussie', () => {
    // La propriété qui distingue ce service de `RateLimitGuard` : compter
    // toutes les requêtes ferait qu'un exploitant assidu se bloquerait
    // lui-même.
    const t = new LoginThrottleService();
    échouer(t, 'a@example.test', '10.0.0.1', 9);
    t.succes('a@example.test', '10.0.0.1');

    expect(() => échouer(t, 'a@example.test', '10.0.0.1', 9)).not.toThrow();
  });

  it('ne laisse pas verrouiller un compte depuis une autre adresse', () => {
    // Sans l'adresse dans la clé, il suffirait de connaître l'email de
    // l'exploitant pour l'enfermer hors de sa propre console.
    const t = new LoginThrottleService();
    échouer(t, 'victime@example.test', '203.0.113.9', 10);

    expect(() => t.verifier('victime@example.test', '10.0.0.1')).not.toThrow();
  });

  it('attrape quand même un balayage de plusieurs comptes depuis une adresse', () => {
    // Le compteur par compte ne voit rien d'un automate qui change d'email à
    // chaque essai ; c'est le filet par adresse qui l'arrête.
    const t = new LoginThrottleService();
    for (let i = 0; i < 50; i += 1) échouer(t, `c${i}@example.test`, '203.0.113.9', 1);

    expect(() => t.verifier('encore@example.test', '203.0.113.9')).toThrow(/Trop de tentatives/);
  });

  it('une réussite n’efface pas le filet par adresse', () => {
    // Sinon un seul compte valide suffirait à rouvrir le balayage de tous
    // les autres depuis ce point.
    const t = new LoginThrottleService();
    for (let i = 0; i < 50; i += 1) échouer(t, `c${i}@example.test`, '203.0.113.9', 1);
    t.succes('c0@example.test', '203.0.113.9');

    expect(() => t.verifier('encore@example.test', '203.0.113.9')).toThrow(/Trop de tentatives/);
  });

  it('compte les adresses inconnues sans planter', () => {
    const t = new LoginThrottleService();
    expect(() => échouer(t, 'a@example.test', '', 3)).not.toThrow();
    expect(() => t.verifier('a@example.test')).not.toThrow();
  });
});
