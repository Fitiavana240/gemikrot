import { deflateSync } from 'node:zlib';

/**
 * Un écrivain PDF minimal, taillé pour ce que le routeur accepte.
 *
 * **Pourquoi pas une bibliothèque.** Le PDF ne part pas vers un navigateur :
 * il est écrit sur le routeur par `PUT /rest/file`, dont le champ `contents`
 * voyage dans du JSON. Tout octet au-delà de 127 y serait ré-encodé en UTF-8
 * et le fichier arriverait corrompu. Il faut donc un PDF **entièrement
 * ASCII** : aucune police ni image embarquée, les accents écrits en
 * échappement octal — `(\351)` pour « é » — et les flux compressés puis
 * réencodés en ASCII85, un couple de filtres que le format porte depuis
 * toujours. Aucune bibliothèque courante ne produit cela.
 *
 * Éprouvé sur le hAP en 7.24.4 : un PDF fabriqué ainsi fait l'aller-retour
 * **octet pour octet**, et RouterOS le range en `.pdf file`.
 *
 * Les polices sont les quatorze que tout lecteur PDF porte d'origine
 * (Helvetica, Courier) : rien à embarquer, donc rien de binaire.
 */

/**
 * **60 Kio, pas un octet de plus.**
 *
 * Sondé sur le hAP en 7.24.4 : `PUT /rest/file` accepte `contents` jusqu'à
 * 61 440 octets et rend `failure: contents too long` au-delà. C'est la vraie
 * contrainte de ce format, et elle décide de tout le reste — sans compression
 * une planche de trente tickets pèse 200 Ko.
 */
export const LIMITE_CONTENU_ROUTEUR = 61_440;

/**
 * ASCII85, tel que le PDF l'attend : cinq caractères imprimables pour quatre
 * octets, `z` pour un groupe nul, et `~>` en terminateur.
 */
function ascii85(données: Buffer): string {
  let sortie = '';
  for (let i = 0; i < données.length; i += 4) {
    const reste = Math.min(4, données.length - i);
    let valeur = 0;
    for (let j = 0; j < 4; j += 1) {
      valeur = valeur * 256 + (j < reste ? données[i + j] : 0);
    }
    if (valeur === 0 && reste === 4) {
      sortie += 'z';
      continue;
    }
    const groupe: string[] = [];
    for (let j = 4; j >= 0; j -= 1) {
      groupe[j] = String.fromCharCode(33 + (valeur % 85));
      valeur = Math.floor(valeur / 85);
    }
    // Un groupe incomplet ne rend que `reste + 1` caractères : c'est la règle
    // du format, et en rendre cinq ajouterait des octets à la fin du fichier.
    sortie += groupe.join('').slice(0, reste + 1);
  }
  return sortie + '~>';
}

/** A4 en points PostScript, l'unité du PDF : 1 pt = 1/72 pouce. */
export const A4 = { largeur: 595.28, hauteur: 841.89 };

/** 1 mm en points, pour raisonner en millimètres comme sur une planche. */
export const MM = 72 / 25.4;

/**
 * Une chaîne PDF sûre, en ASCII pur.
 *
 * Les parenthèses et la barre oblique délimitent et échappent dans la syntaxe
 * PDF : les laisser passer casserait le fichier sur le premier nom d'offre
 * contenant une parenthèse. Au-delà de 127, l'octal rend le caractère tel que
 * `WinAnsiEncoding` l'attend, sans jamais sortir de l'ASCII.
 */
export function texteSûr(valeur: string): string {
  let sortie = '';
  for (const caractère of valeur.normalize('NFC')) {
    const code = caractère.codePointAt(0)!;
    if (caractère === '(' || caractère === ')' || caractère === '\\') {
      sortie += '\\' + caractère;
    } else if (code < 32) {
      sortie += ' ';
    } else if (code < 127) {
      sortie += caractère;
    } else if (code <= 255) {
      sortie += '\\' + code.toString(8).padStart(3, '0');
    } else {
      // Hors de WinAnsi : un caractère de remplacement vaut mieux qu'un
      // fichier illisible. Les noms d'offres de ce parc restent en latin.
      sortie += '?';
    }
  }
  return sortie;
}

/** Nombre au format PDF : point décimal, jamais de notation scientifique. */
function nb(valeur: number): string {
  return (Math.round(valeur * 100) / 100).toString();
}

/** Ce qu'on peut poser sur une page. */
export interface Dessin {
  texte(x: number, y: number, contenu: string, options?: { taille?: number; police?: 'H' | 'HB' | 'C'; gris?: number }): void;
  rectangle(x: number, y: number, largeur: number, hauteur: number, gris?: number): void;
  trait(x1: number, y1: number, x2: number, y2: number, gris?: number): void;
}

/**
 * Construit le document. `pages` reçoit un dessinateur par page.
 *
 * L'origine PDF est **en bas à gauche**, contrairement à tout le reste de
 * cette application. C'est la convention du format et la changer ici ferait
 * mentir les coordonnées qu'on lit dans un fichier PDF ouvert à la main.
 */
export function construirePdf(pages: ((d: Dessin) => void)[]): string {
  const flux: string[] = [];

  for (const remplir of pages) {
    const morceaux: string[] = [];
    let policeCourante = '';
    let grisCourant = -1;

    const poserGris = (gris: number) => {
      if (gris !== grisCourant) {
        morceaux.push(`${nb(gris)} g`);
        grisCourant = gris;
      }
    };

    remplir({
      texte(x, y, contenu, options = {}) {
        const police = options.police ?? 'H';
        const taille = options.taille ?? 9;
        poserGris(options.gris ?? 0);
        if (police !== policeCourante) policeCourante = police;
        morceaux.push(`BT /${police} ${nb(taille)} Tf ${nb(x)} ${nb(y)} Td (${texteSûr(contenu)}) Tj ET`);
      },
      rectangle(x, y, largeur, hauteur, gris = 0) {
        poserGris(gris);
        morceaux.push(`${nb(x)} ${nb(y)} ${nb(largeur)} ${nb(hauteur)} re f`);
      },
      trait(x1, y1, x2, y2, gris = 0.8) {
        poserGris(gris);
        morceaux.push(`${nb(gris)} G ${nb(x1)} ${nb(y1)} m ${nb(x2)} ${nb(y2)} l S`);
      },
    });

    flux.push(morceaux.join('\n') + '\n');
  }

  // --- assemblage : catalogue, arbre de pages, polices, puis une page et un
  // flux par planche. Les numéros d'objets sont calculés d'avance parce que
  // la table de références croisées exige leur décalage exact.
  const objets: string[] = [];
  const idPages = 2;
  const premierePage = 6;

  objets.push(`<< /Type /Catalog /Pages ${idPages} 0 R >>`);
  const idsPages = flux.map((_, i) => premierePage + i * 2);
  objets.push(
    `<< /Type /Pages /Kids [${idsPages.map((id) => `${id} 0 R`).join(' ')}] /Count ${flux.length} >>`,
  );
  objets.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objets.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  objets.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');

  for (const [i, contenu] of flux.entries()) {
    objets.push(
      `<< /Type /Page /Parent ${idPages} 0 R /MediaBox [0 0 ${nb(A4.largeur)} ${nb(A4.hauteur)}] ` +
        `/Resources << /Font << /H 3 0 R /HB 4 0 R /C 5 0 R >> >> /Contents ${premierePage + i * 2 + 1} 0 R >>`,
    );
    // Compressé puis encodé en ASCII85 : les deux filtres sont dans le format
    // depuis toujours, et l'encodage ramène le flux dans l'ASCII qu'exige le
    // champ `contents` de RouterOS. Sans cela une planche de trente tickets
    // dépasse la limite de 60 Kio et n'arrive jamais sur le routeur.
    const encodé = ascii85(deflateSync(Buffer.from(contenu, 'latin1')));
    objets.push(
      `<< /Length ${encodé.length} /Filter [/ASCII85Decode /FlateDecode] >>\nstream\n${encodé}\nendstream`,
    );
  }

  let document = '%PDF-1.4\n';
  const décalages: number[] = [];
  for (const [i, objet] of objets.entries()) {
    décalages.push(document.length);
    document += `${i + 1} 0 obj\n${objet}\nendobj\n`;
  }

  const débutXref = document.length;
  document += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const décalage of décalages) document += `${décalage.toString().padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${débutXref}\n%%EOF\n`;

  return document;
}
