import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Le gabarit de la page captive part-il avec l'image ?
 *
 * `hotspot/login.html` n'est pas du code : il ne passe pas par `dist/`, donc
 * rien ne l'emporte de lui-même. Il ne partait nulle part. Sur le serveur,
 * publier la page du portail répondait « Le modèle de page de connexion est
 * introuvable » — pendant que tout le reste fonctionnait.
 *
 * **C'est la page qui porte le bouton d'achat.** Sans elle, aucun client ne
 * peut payer : il voit l'écran de connexion d'origine du routeur, sans prix,
 * sans numéro, sans rien. La panne ne se voit d'aucun écran d'administration
 * et ne se signale pas — un client qui ne peut pas acheter s'en va.
 *
 * Ces tests tiennent les deux bouts : le fichier voyage, et ses marqueurs
 * correspondent exactement à ce que le service y remplace. Un marqueur
 * renommé d'un seul côté laisserait `__PORTAIL__` écrit en toutes lettres sur
 * l'écran d'un client.
 */

const RACINE = resolve(__dirname, '../../../..');
const GABARIT = resolve(RACINE, 'hotspot/login.html');
const DOCKERFILE = resolve(RACINE, 'deploiement/Dockerfile.backend');
const SERVICE = resolve(__dirname, 'page-connexion.service.ts');

function marqueurs(texte: string): string[] {
  return [...new Set(texte.match(/__[A-Z_]+__/g) ?? [])].sort();
}

describe('le gabarit de la page captive', () => {
  it('existe là où le service le cherche', () => {
    expect(() => readFileSync(GABARIT, 'utf8')).not.toThrow();
  });

  it("est copié dans l'image de production", () => {
    const dockerfile = readFileSync(DOCKERFILE, 'utf8');
    // Le service le cherche quatre niveaux au-dessus de `dist/hotspot`, soit
    // `/app/hotspot` : c'est ce dossier-là qui doit arriver dans l'image.
    expect(dockerfile).toMatch(/^COPY --from=build \/app\/hotspot \.\/hotspot$/m);
  });

  it('grave l’identité du routeur dans le lien d’achat', () => {
    // Sans elle, un exploitant à deux sites vend depuis la même adresse : le
    // client paie au site B, et la vérification crée son ticket sur « le plus
    // ancien routeur de l'exploitant », donc au site A. Son code ne marche
    // pas là où il se trouve, et rien ne dit pourquoi — ni à lui, ni au
    // vendeur. La panne est invisible tant qu'il n'y a qu'un routeur, c'est
    //-à-dire pendant tout le développement.
    const gabarit = readFileSync(GABARIT, 'utf8');
    expect(gabarit).toMatch(/href="__PORTAIL__\/p\/__SLUG__\?r=__ROUTEUR__"/);
  });

  it('ne porte aucun marqueur que le service ne remplace', () => {
    const service = readFileSync(SERVICE, 'utf8');
    const remplaces = marqueurs(
      (service.match(/replaceAll\('__[A-Z_]+__'/g) ?? []).join(' '),
    );
    const oublies = marqueurs(readFileSync(GABARIT, 'utf8')).filter(
      (m) => !remplaces.includes(m),
    );
    // Un marqueur oublié s'affiche tel quel chez le client, en majuscules et
    // entre soulignés, sur la page qu'il consulte pour payer.
    expect(oublies).toEqual([]);
  });

  it('porte tous les marqueurs que le service remplace', () => {
    const service = readFileSync(SERVICE, 'utf8');
    const remplaces = marqueurs(
      (service.match(/replaceAll\('__[A-Z_]+__'/g) ?? []).join(' '),
    );
    const absents = remplaces.filter(
      (m) => !readFileSync(GABARIT, 'utf8').includes(m),
    );
    // L'inverse est plus sournois : le service remplace dans le vide, la page
    // se publie sans erreur, et le réglage de l'exploitant n'apparaît nulle
    // part. Rien ne le signale.
    expect(absents).toEqual([]);
  });
});
