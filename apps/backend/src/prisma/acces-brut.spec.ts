import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TENANT_SCOPED_MODELS } from './prisma.service.js';

/**
 * Chaque lecture non cloisonnée doit dire pourquoi.
 *
 * `prisma.scoped` filtre par exploitant ; `this.prisma.<modèle>` ne filtre
 * rien. La deuxième forme est parfois la bonne — un travail de fond parcourt
 * tout le parc, l'inscription précède l'existence d'un exploitant — mais elle
 * s'écrit exactement comme la première, et rien ne distingue le choix
 * délibéré de l'oubli.
 *
 * L'oubli est arrivé : l'import de routeur résolvait son routeur avec le
 * client brut, puis se plaçait sur l'exploitant **du routeur**. Un ADMIN qui
 * connaissait l'identifiant d'un routeur d'un autre exploitant déclenchait
 * donc un import dans les données de cet autre, et en recevait le détail en
 * réponse. Le code compilait, les épreuves passaient, et l'épreuve
 * d'isolation ne pouvait pas l'attraper : elle éprouve l'extension Prisma,
 * pas les contrôleurs.
 *
 * **Un marqueur plutôt qu'une liste blanche.** Une liste centrale dérive :
 * on y ajoute un fichier le jour où l'épreuve tombe, sans relire ce qu'on
 * autorise. Le marqueur vit à côté de la ligne, se relit avec elle, et un
 * nouvel accès brut ne passe qu'en écrivant sa raison.
 */

const MARQUEUR = 'hors cloisonnement';
/** Le marqueur est cherché dans les lignes qui précèdent immédiatement. */
const PORTEE_LIGNES = 6;

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..');

/** `Router` → `router`, la forme sous laquelle Prisma expose le modèle. */
function proprieteDuModele(modele: string): string {
  return modele.charAt(0).toLowerCase() + modele.slice(1);
}

function fichiersSources(dossier: string): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) {
      trouves.push(...fichiersSources(chemin));
      continue;
    }
    // Les épreuves montent leurs propres simulacres : le cloisonnement ne
    // s'y joue pas, et les y interdire ferait du bruit sans garantie.
    if (entree.endsWith('.ts') && !entree.endsWith('.spec.ts')) trouves.push(chemin);
  }
  return trouves;
}

interface AccesBrut {
  fichier: string;
  ligne: number;
  modele: string;
  texte: string;
}

function accesBrutsNonJustifies(): AccesBrut[] {
  const proprietes = [...TENANT_SCOPED_MODELS].map(proprieteDuModele);
  // `\b` après le nom : `payment` ne doit pas attraper `paymentClaim`, qui a
  // sa propre entrée et pourrait être justifié différemment.
  const motif = new RegExp(`this\\.prisma\\.(${proprietes.join('|')})\\b`);

  const trouves: AccesBrut[] = [];
  for (const fichier of fichiersSources(RACINE)) {
    const lignes = readFileSync(fichier, 'utf8').split(/\r?\n/);
    lignes.forEach((texte, index) => {
      const trouve = motif.exec(texte);
      if (!trouve) return;

      const debut = Math.max(0, index - PORTEE_LIGNES);
      const contexte = lignes.slice(debut, index + 1).join('\n');
      // Insensible à la casse : le marqueur ouvre souvent une phrase, et
      // faire tomber l'épreuve sur une majuscule serait une charade.
      if (contexte.toLowerCase().includes(MARQUEUR)) return;

      trouves.push({
        fichier: relative(RACINE, fichier).replace(/\\/g, '/'),
        ligne: index + 1,
        modele: trouve[1],
        texte: texte.trim(),
      });
    });
  }
  return trouves;
}

describe('les accès non cloisonnés', () => {
  it('disent tous pourquoi', () => {
    const sansRaison = accesBrutsNonJustifies();

    // Le message porte le fichier et la ligne : une épreuve qui dit
    // seulement « il en reste trois » oblige à les chercher.
    expect(
      sansRaison.map((a) => `${a.fichier}:${a.ligne} — ${a.texte}`),
      `Ces accès contournent le cloisonnement sans dire pourquoi. Si c'est ` +
        `délibéré, écrivez « ${MARQUEUR} » et la raison juste au-dessus. ` +
        `Sinon, passez par « prisma.scoped » ou « prisma.scopedStrict ».`,
    ).toEqual([]);
  });

  it('sont cherchés sur la liste que le service tient lui-même', () => {
    // La garantie tomberait en silence si les deux listes divergeaient : un
    // modèle cloisonné ajouté au service mais oublié ici ne serait plus
    // surveillé, et personne ne le verrait.
    expect(TENANT_SCOPED_MODELS.size).toBeGreaterThan(0);
    expect(TENANT_SCOPED_MODELS.has('Router')).toBe(true);
  });
});
