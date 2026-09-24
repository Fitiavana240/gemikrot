import { describe, expect, it } from 'vitest';
import * as serveur from './identifiant.js';

/**
 * Le fichier du navigateur, chargé par son chemin plutôt qu'importé.
 *
 * Il ne dépend de rien — ni de React, ni du serveur — et c'est ce qui rend
 * la comparaison possible. Mais il vit hors du `rootDir` de ce projet : un
 * `import` en clair le ferait entrer dans la compilation du serveur, et
 * `tsc` s'y refuse à juste titre. Le chemin calculé reste invisible à la
 * vérification de types, et se résout à l'exécution.
 *
 * Le prix de ce détour : la forme du module n'est pas vérifiée à la
 * compilation. Une fonction renommée d'un côté tombera ici, à l'exécution —
 * ce qui est précisément le genre de divergence que ce fichier existe pour
 * attraper.
 */
const cheminNavigateur = new URL(
  '../../../frontend/src/pages/public/identifiant.ts',
  import.meta.url,
).href;
const navigateur = (await import(/* @vite-ignore */ cheminNavigateur)) as typeof serveur;

/**
 * Les deux copies doivent donner le même résultat.
 *
 * La règle qui transforme un nom en identifiant existe **deux fois** : une
 * dans la page publique, une dans le serveur. Ce n'est pas un oubli — le
 * client doit voir son identifiant pendant qu'il tape, donc avant tout appel,
 * et le serveur doit le recalculer parce qu'un champ envoyé par un navigateur
 * ne prouve rien.
 *
 * Mais deux copies dérivent. Le jour où l'une change seule, la page annonce
 * « Rakoto-Jean » et le serveur réserve « RakotoJean » : le client paie, reçoit
 * un identifiant qu'il n'a jamais vu, et sa première tentative de connexion
 * échoue. Il ne peut pas deviner, et personne ne peut lui expliquer.
 *
 * Ces épreuves comparent les deux implémentations sur le même jeu de noms,
 * plutôt que de vérifier chacune dans son coin : c'est la divergence qui fait
 * mal, pas l'erreur commune. Le jour où la règle passera dans un paquet
 * partagé — prévu avec le découpage du bundle public — ce fichier n'aura
 * plus lieu d'être.
 */

/** Ce qu'on rencontre vraiment au guichet, à Toliara. */
const NOMS = [
  'Rakoto Jean',
  'Razafindrakoto Jean-Baptiste Nirina',
  'Hasina',
  'Élodie',
  "Andrianasolo d'Ambohipo",
  'Naivo  Doublon',
  '   Tsiry   ',
  'Jean-Baptiste-Ra',
  '2024',
  'A',
  'Rakoto@Jean.mg',
  'Fanja (vendeuse)',
  'Ny Aina Rasoanaivo Mihanta Fanomezantsoa',
  '——',
  '',
  'Ràkötö',
  'Jean_Pierre',
  'ÉÈÊË',
];

describe('la règle d’identifiant, des deux côtés', () => {
  it('transforme les noms à l’identique', () => {
    const cotéServeur = NOMS.map((nom) => `${nom} → ${serveur.identifiantDepuisNom(nom)}`);
    const cotéNavigateur = NOMS.map((nom) => `${nom} → ${navigateur.identifiantDepuisNom(nom)}`);

    // Comparées en bloc et non nom par nom : la sortie d'échec montre alors
    // d'un coup lesquels divergent, au lieu de s'arrêter au premier.
    expect(cotéNavigateur).toEqual(cotéServeur);
  });

  it('acceptent et refusent les mêmes', () => {
    const verdict = (m: typeof serveur) =>
      NOMS.map((nom) => {
        const identifiant = m.identifiantDepuisNom(nom);
        return `${identifiant || '(vide)'} : ${m.identifiantUtilisable(identifiant) ? 'oui' : 'non'}`;
      });

    expect(verdict(navigateur)).toEqual(verdict(serveur));
  });

  it('rapprochent les mêmes paires', () => {
    // La casse est le piège : RouterOS traiterait `Rakoto` et `rakoto` comme
    // deux comptes sur certains chemins, et deux clients croiraient chacun
    // posséder le leur.
    const paires: [string, string][] = [
      ['Rakoto', 'rakoto'],
      ['Rakoto', 'Rakoto'],
      ['Rakoto', 'Rakoto2'],
      ['ÉLODIE', 'élodie'],
      ['', ''],
    ];
    const verdict = (m: typeof serveur) =>
      paires.map(([a, b]) => `${a} ~ ${b} : ${m.mêmeIdentifiant(a, b) ? 'oui' : 'non'}`);

    expect(verdict(navigateur)).toEqual(verdict(serveur));
  });
});

/**
 * Ce que la règle doit faire, indépendamment de la question de la copie.
 *
 * Une épreuve différentielle seule laisserait passer la même erreur des deux
 * côtés : deux implémentations identiques et fausses se valident l'une
 * l'autre sans rien prouver.
 */
describe('la règle d’identifiant', () => {
  it('recolle les espaces avec un tiret', () => {
    expect(serveur.identifiantDepuisNom('Rakoto Jean')).toBe('Rakoto-Jean');
  });

  it('retire les accents, parce qu’un clavier de portail captif n’en a pas', () => {
    expect(serveur.identifiantDepuisNom('Élodie')).toBe('Elodie');
  });

  it('garde la casse : elle aide à se relire', () => {
    expect(serveur.identifiantDepuisNom('Hasina')).toBe('Hasina');
  });

  it('ne laisse jamais un tiret en bout, même après la coupe', () => {
    // Un nom coupé à vingt-quatre caractères peut retomber pile sur un tiret,
    // et « Jean-Baptiste-Nirina-Ra- » se retape de travers.
    for (const nom of NOMS) {
      const identifiant = serveur.identifiantDepuisNom(nom);
      expect(identifiant).not.toMatch(/^-|-$/);
    }
  });

  it('refuse un identifiant sans aucune lettre', () => {
    // « 2024 » se confondrait avec une référence de paiement, et deux clients
    // le choisiraient le même jour.
    expect(serveur.identifiantUtilisable(serveur.identifiantDepuisNom('2024'))).toBe(false);
  });

  it('refuse trop court, accepte à la limite', () => {
    expect(serveur.identifiantUtilisable('Ra')).toBe(false);
    expect(serveur.identifiantUtilisable('Rak')).toBe(true);
    expect(serveur.identifiantUtilisable('R'.repeat(24))).toBe(true);
    expect(serveur.identifiantUtilisable('R'.repeat(25))).toBe(false);
  });
});
