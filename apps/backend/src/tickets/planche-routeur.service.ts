import { Injectable, Logger } from '@nestjs/common';
import type { IMikrotikService } from '@wifitati/mikrotik-service';
import { LIMITE_CONTENU_ROUTEUR } from './pdf.util.js';
import { TicketPdfService, type PlancheDemande, type TicketÀImprimer } from './ticket-pdf.service.js';

export interface PlancheÉcrite {
  /** Chemin complet sur le routeur, tel que WinBox le montre. */
  chemin: string;
  tickets: number;
  octets: number;
}

export interface RapportPlanches {
  planches: PlancheÉcrite[];
  /** Ce qui n'a pas pu être écrit, avec la raison, sans arrêter le reste. */
  échecs: { chemin: string; motif: string }[];
  /** Racine choisie sur le routeur, et pourquoi. */
  emplacement: string;
}

/**
 * Où déposer les planches, et pourquoi ce n'est pas un choix libre.
 *
 * La mémoire interne de ce hAP a **278 Ko libres sur 16 Mo** — relevé, pas
 * supposé. Une seule planche de trente tickets en fait 55 : deux générations
 * rempliraient la flash, et une flash pleine empêche RouterOS d'écrire ses
 * journaux comme de prendre une sauvegarde. La clé USB, elle, a 975 Mo.
 *
 * Écrire sur la flash n'est donc pas une solution de repli acceptable : mieux
 * vaut dire que la clé manque que de remplir la mémoire du routeur en silence.
 */
const RACINE_USB = 'usb1-part1';
const DOSSIER = 'tickets';

@Injectable()
export class PlancheRouteurService {
  private readonly logger = new Logger(PlancheRouteurService.name);

  constructor(private readonly pdf: TicketPdfService) {}

  /**
   * Découpe le lot en planches A4 et les écrit sur le routeur.
   *
   * Une planche par fichier, parce que `PUT /rest/file` refuse au-delà de
   * 61 440 octets et qu'un PDF ne se poursuit pas d'un fichier à l'autre. Un
   * lot de deux cents tickets donne donc sept fichiers numérotés, ce qui est
   * aussi ce qu'on imprime : sept feuilles.
   */
  async écrire(
    mikrotik: IMikrotikService,
    demande: Omit<PlancheDemande, 'tickets'> & { tickets: TicketÀImprimer[]; étiquette: string },
  ): Promise<RapportPlanches> {
    const racine = await this.racineDisponible(mikrotik);
    const rapport: RapportPlanches = { planches: [], échecs: [], emplacement: racine };
    if (!racine) return rapport;

    const groupes = this.grouper(demande.tickets, demande);
    for (const [index, groupe] of groupes.entries()) {
      const contenu = this.pdf.planche({ ...demande, tickets: groupe });
      const suffixe = groupes.length > 1 ? `-p${index + 1}` : '';
      const chemin = `${racine}/${DOSSIER}/${demande.étiquette}${suffixe}.pdf`;

      try {
        await mikrotik.writeRouterFile(chemin, contenu);
        rapport.planches.push({ chemin, tickets: groupe.length, octets: contenu.length });
      } catch (error) {
        // Une planche en échec n'annule pas les autres : les tickets existent
        // déjà sur le routeur, et sept feuilles moins une valent mieux que
        // rien du tout.
        rapport.échecs.push({ chemin, motif: error instanceof Error ? error.message : String(error) });
        this.logger.warn(`Planche ${chemin} non écrite : ${String(error)}`);
      }
    }
    return rapport;
  }

  /**
   * Groupe les tickets de façon qu'aucun fichier ne dépasse la limite.
   *
   * Le nombre par page vient du modèle de ticket, mais il ne suffit pas : un
   * QR qui encode une URL de portail pèse plus qu'un QR qui ne porte qu'un
   * code, et un nom d'offre long ajoute encore. La taille est donc **mesurée**
   * sur le PDF produit, et le groupe est coupé en deux tant qu'il déborde.
   */
  private grouper(tickets: TicketÀImprimer[], demande: Omit<PlancheDemande, 'tickets'>): TicketÀImprimer[][] {
    const groupes: TicketÀImprimer[][] = [];
    let reste = [...tickets];

    while (reste.length > 0) {
      let taille = Math.min(demande.parPage, reste.length);
      while (taille > 1) {
        const essai = this.pdf.planche({ ...demande, tickets: reste.slice(0, taille) });
        if (essai.length <= LIMITE_CONTENU_ROUTEUR) break;
        taille = Math.floor(taille / 2);
      }
      groupes.push(reste.slice(0, taille));
      reste = reste.slice(taille);
    }
    return groupes;
  }

  /**
   * La clé USB, ou rien.
   *
   * On ne se rabat pas sur la flash interne : 278 Ko libres n'accueillent pas
   * une planche, et la remplir mettrait le routeur en difficulté bien au-delà
   * des tickets.
   */
  private async racineDisponible(mikrotik: IMikrotikService): Promise<string> {
    try {
      const fichiers = await mikrotik.getRouterFiles();
      const disques = fichiers.filter((f) => f.type === 'disk').map((f) => f.name);
      if (disques.includes(RACINE_USB)) return RACINE_USB;

      // Une clé peut porter un autre nom de partition selon le port utilisé.
      const autre = disques.find((nom) => nom.startsWith('usb'));
      if (autre) return autre;

      this.logger.warn("Aucune clé USB sur le routeur : les planches ne sont pas écrites");
      return '';
    } catch (error) {
      this.logger.warn(`Disques du routeur illisibles : ${String(error)}`);
      return '';
    }
  }
}
