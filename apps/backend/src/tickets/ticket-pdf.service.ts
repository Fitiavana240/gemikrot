import { Injectable } from '@nestjs/common';
import qrcode from 'qrcode-generator';
import { A4, MM, construirePdf, type Dessin } from './pdf.util.js';
import { contenuQr } from './qr.util.js';

export interface TicketÀImprimer {
  code: string;
  /** Nom de l'offre, tel que le client le lira. */
  offre: string;
  /** Prix déjà formaté, devise comprise. Vide si l'offre n'en porte pas. */
  prix: string;
}

export interface PlancheDemande {
  tickets: TicketÀImprimer[];
  /** Durée de validité, en secondes. Rendue en heures sur le ticket. */
  validitéSecondes: number | null;
  /** Nom du réseau, imprimé en tête de chaque ticket. */
  réseau: string;
  /** Domaines du portail, pour que le QR connecte au lieu de porter un code. */
  domaines: string[];
  /** Tickets par planche A4. Repris du modèle de ticket choisi. */
  parPage: number;
}

/**
 * La validité d'une offre, **en heures**.
 *
 * Demandé tel quel : un ticket dit « valable 24 h », pas « 1 j ». Les deux
 * sont vrais, mais l'exploitant vend des heures et ses offres s'appellent
 * « 2Heure-500Ar » — mêler les unités sur le papier oblige le vendeur à
 * convertir devant le client.
 *
 * En dessous de l'heure, les minutes : « 0,25 h » n'aide personne.
 */
export function validitéEnHeures(secondes: number | null): string {
  if (secondes == null || secondes <= 0) return 'sans limite';
  if (secondes < 3600) return `${Math.round(secondes / 60)} min`;

  const heures = secondes / 3600;
  return `${Number.isInteger(heures) ? heures : heures.toFixed(1).replace('.', ',')} h`;
}

/**
 * Découpe la planche A4 en cellules.
 *
 * Les grilles sont posées à la main pour les formats du parc plutôt que
 * calculées : 30 par page veut dire 3 × 10 (des cellules de 64 × 28 mm,
 * celles des planches déjà utilisées), et non 5 × 6, qui tiendrait
 * arithmétiquement mais donnerait des cellules trop étroites pour un QR.
 */
function grille(parPage: number): { colonnes: number; lignes: number } {
  const connues: Record<number, { colonnes: number; lignes: number }> = {
    30: { colonnes: 3, lignes: 10 },
    24: { colonnes: 3, lignes: 8 },
    21: { colonnes: 3, lignes: 7 },
    12: { colonnes: 2, lignes: 6 },
    10: { colonnes: 2, lignes: 5 },
    8: { colonnes: 2, lignes: 4 },
    4: { colonnes: 2, lignes: 2 },
  };
  if (connues[parPage]) return connues[parPage];

  // Format inconnu : on cherche la grille la moins déformée, en gardant des
  // cellules plus larges que hautes — un code tient mal sur une colonne.
  const colonnes = Math.max(1, Math.min(4, Math.round(Math.sqrt(parPage / 2))));
  return { colonnes, lignes: Math.ceil(parPage / colonnes) };
}

@Injectable()
export class TicketPdfService {
  /**
   * Une planche A4 prête à découper, en PDF.
   *
   * Tout y est vectoriel, **QR compris** : le format n'accepte une image que
   * sous forme binaire, et le fichier doit rester ASCII pour traverser le
   * champ `contents` de RouterOS. Un QR étant une grille de carrés noirs, le
   * dessiner en rectangles ne perd rien — et reste net à l'impression, ce
   * qu'une image de quelques dizaines de pixels ne serait pas.
   */
  planche(demande: PlancheDemande): string {
    const { colonnes, lignes } = grille(demande.parPage);
    const marge = 8 * MM;
    const largeurCellule = (A4.largeur - 2 * marge) / colonnes;
    const hauteurCellule = (A4.hauteur - 2 * marge) / lignes;
    const parPage = colonnes * lignes;

    const pages: ((d: Dessin) => void)[] = [];
    for (let début = 0; début < demande.tickets.length; début += parPage) {
      const lot = demande.tickets.slice(début, début + parPage);
      pages.push((d) => {
        // Les repères de découpe d'abord : ils passent sous les tickets.
        for (let c = 1; c < colonnes; c += 1) {
          const x = marge + c * largeurCellule;
          d.trait(x, marge, x, A4.hauteur - marge, 0.85);
        }
        for (let l = 1; l < lignes; l += 1) {
          const y = marge + l * hauteurCellule;
          d.trait(marge, y, A4.largeur - marge, y, 0.85);
        }

        lot.forEach((ticket, index) => {
          const colonne = index % colonnes;
          const ligne = Math.floor(index / colonnes);
          // L'origine PDF est en bas à gauche : la première ligne est en haut.
          const x = marge + colonne * largeurCellule;
          const y = A4.hauteur - marge - (ligne + 1) * hauteurCellule;
          this.ticket(d, ticket, demande, x, y, largeurCellule, hauteurCellule);
        });
      });
    }

    return construirePdf(pages);
  }

  private ticket(
    d: Dessin,
    ticket: TicketÀImprimer,
    demande: PlancheDemande,
    x: number,
    y: number,
    largeur: number,
    hauteur: number,
  ): void {
    const pad = 3 * MM;
    const côtéQr = Math.min(hauteur - 2 * pad, largeur * 0.32);
    const largeurTexte = largeur - côtéQr - 3 * pad;

    // Le QR à droite : la main qui découpe tient le ticket par la gauche.
    this.qr(d, contenuQr(ticket.code, demande.domaines), x + largeur - pad - côtéQr, y + (hauteur - côtéQr) / 2, côtéQr);

    let ligne = y + hauteur - pad - 7;
    d.texte(x + pad, ligne, demande.réseau, { taille: 6.5, gris: 0.45 });

    ligne -= 13;
    // Le code en Courier gras : c'est ce que le client tape, et un `0` doit se
    // distinguer d'un `O` sans hésitation possible.
    const tailleCode = Math.min(13, (largeurTexte / Math.max(ticket.code.length, 1)) * 1.7);
    d.texte(x + pad, ligne, ticket.code, { taille: tailleCode, police: 'C' });

    ligne -= 10;
    d.texte(x + pad, ligne, ticket.offre, { taille: 6.5, police: 'HB', gris: 0.25 });

    if (ticket.prix) {
      ligne -= 8;
      d.texte(x + pad, ligne, ticket.prix, { taille: 7 });
    }

    ligne -= 8;
    d.texte(x + pad, ligne, `valable ${validitéEnHeures(demande.validitéSecondes)}`, {
      taille: 6.5,
      gris: 0.45,
    });
  }

  /** Le QR en rectangles pleins, un par module sombre. */
  private qr(d: Dessin, contenu: string, x: number, y: number, côté: number): void {
    const qr = qrcode(0, 'M');
    qr.addData(contenu);
    qr.make();

    const modules = qr.getModuleCount();
    // Une marge de deux modules, la « zone calme » sans laquelle beaucoup de
    // lecteurs refusent de décoder.
    const pas = côté / (modules + 4);

    // Les modules sombres voisins sont fondus en un seul rectangle par série.
    // Un module par rectangle donnait ~300 ordres de dessin par QR, et une
    // planche de trente tickets dépassait alors la limite du routeur même
    // compressée. Le résultat imprimé est identique — et sans les liserés
    // blancs que laissent parfois des rectangles simplement juxtaposés.
    for (let ligne = 0; ligne < modules; ligne += 1) {
      let début = -1;
      for (let colonne = 0; colonne <= modules; colonne += 1) {
        const sombre = colonne < modules && qr.isDark(ligne, colonne);
        if (sombre && début === -1) début = colonne;
        if (!sombre && début !== -1) {
          d.rectangle(
            x + (début + 2) * pas,
            // L'origine PDF est en bas : la première ligne du QR est en haut.
            y + côté - (ligne + 3) * pas,
            (colonne - début) * pas,
            pas,
          );
          début = -1;
        }
      }
    }
  }
}
