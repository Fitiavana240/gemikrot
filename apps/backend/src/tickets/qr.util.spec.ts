import { describe, expect, it } from 'vitest';
import { contenuQr, qrDataUri } from './qr.util.js';

describe('contenuQr', () => {
  it("encode l'adresse de connexion quand un domaine de portail est déclaré", () => {
    // Un scan doit connecter, pas afficher du texte à recopier. RouterOS
    // accepte les identifiants en paramètres de `/login`, et le code sert
    // à la fois de nom et de mot de passe.
    expect(contenuQr('H828018', ['wifitati.net'])).toBe(
      'http://wifitati.net/login?username=H828018&password=H828018',
    );
  });

  it('retombe sur le code seul sans domaine', () => {
    // Moins bien — il faudra le coller dans le portail — mais toujours mieux
    // que de recopier dix caractères, ce que ce code existe pour éviter.
    expect(contenuQr('H828018', [])).toBe('H828018');
  });

  it('ignore un domaine vide plutôt que de fabriquer « http:/// »', () => {
    expect(contenuQr('H828018', ['', '   '])).toBe('H828018');
    expect(contenuQr('H828018', ['  ', 'wifitati.net'])).toContain('http://wifitati.net/');
  });

  it("échappe le code dans l'adresse", () => {
    // Les codes du générateur n'ont que des lettres et des chiffres, mais un
    // préfixe saisi à la main peut porter n'importe quoi — et un `&` non
    // échappé couperait le mot de passe en deux paramètres.
    const url = contenuQr('A&B=C', ['portail.test']);
    expect(url).toBe('http://portail.test/login?username=A%26B%3DC&password=A%26B%3DC');
  });
});

describe('qrDataUri', () => {
  it('rend une image SVG utilisable telle quelle dans un src', () => {
    const uri = qrDataUri('H828018');

    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const svg = Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString();
    expect(svg).toContain('<svg');
    // `viewBox` sans dimensions figées : le gabarit donne la taille, en
    // millimètres s'il le veut. Une image matricielle sortirait floue sur
    // une cellule de 16 mm, et un QR flou ne se lit pas.
    expect(svg).toContain('viewBox');
  });

  it('produit un motif différent pour un code différent', () => {
    // Garde-fou contre le pire des défauts possibles ici : un QR identique
    // sur toute la planche, qui enverrait tous les clients sur le même code.
    expect(qrDataUri('AAAA1111')).not.toBe(qrDataUri('BBBB2222'));
  });

  it('accepte une URL complète sans déborder de sa version', () => {
    const uri = qrDataUri('http://wifitati.net/login?username=H828018&password=H828018');
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });
});
