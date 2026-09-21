import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * La recette : ce qui est entré, quand, et par quelle offre.
 *
 * Le tableau de bord donnait déjà un total par offre, mais **depuis
 * toujours** : on y lisait le cumul de l'histoire, jamais « ce mois-ci ».
 * Impossible d'y voir qu'une offre a cessé de se vendre, ni de comparer un
 * mois au précédent — or c'est la seule question que l'exploitant pose à ses
 * chiffres.
 *
 * Deux règles tiennent tout le reste.
 *
 * **Seuls les paiements vérifiés comptent.** Un paiement en attente est une
 * promesse, pas une recette ; l'inclure gonflerait le chiffre d'un montant
 * qui peut ne jamais arriver.
 *
 * **La date qui compte est celle de la vérification**, pas celle de la
 * déclaration. C'est le moment où l'argent est reconnu ; un règlement
 * déclaré le 31 et vérifié le 2 appartient au mois suivant, et c'est aussi
 * ce que dirait un comptable.
 */

export type Pas = 'jour' | 'semaine' | 'mois';

export interface LigneRecette {
  /** Début de la tranche, en ISO. */
  début: string;
  planId: string;
  planName: string;
  nombre: number;
  montant: number;
}

export interface Recette {
  devise: string | null;
  du: string;
  au: string;
  pas: Pas;
  total: number;
  nombre: number;
  lignes: LigneRecette[];
  /** Cumul par offre sur toute la période, pour le classement. */
  parOffre: { planId: string; planName: string; nombre: number; montant: number }[];
}

/**
 * Le début de la tranche qui contient cette date.
 *
 * En heure **locale du serveur**, et non en UTC : une vente de 22 h à
 * Toliara tomberait la veille en UTC, et le total d'une journée ne
 * correspondrait plus à la caisse du soir.
 */
export function débutDeTranche(date: Date, pas: Pas): Date {
  if (pas === 'mois') return new Date(date.getFullYear(), date.getMonth(), 1);
  if (pas === 'semaine') {
    // Semaine ISO : lundi premier jour. `getDay()` rend 0 le dimanche.
    const recul = (date.getDay() + 6) % 7;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - recul);
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Un champ CSV : guillemets doublés, et entouré dès qu'il porte un séparateur. */
export function champCsv(valeur: unknown): string {
  const texte = valeur == null ? '' : String(valeur);
  // Le point-virgule est le séparateur : c'est celui qu'attend un tableur
  // configuré en français, là où la virgule est le séparateur décimal.
  return /[";\n\r]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

@Injectable()
export class RecettesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Les paiements vérifiés d'une période, regroupés par tranche et par offre.
   */
  async recette(du: Date, au: Date, pas: Pas): Promise<Recette> {
    const paiements = await this.prisma.scoped.payment.findMany({
      where: {
        status: PaymentStatus.VERIFIED,
        verifiedAt: { gte: du, lte: au },
      },
      select: {
        amount: true,
        currency: true,
        planId: true,
        verifiedAt: true,
        plan: { select: { name: true } },
      },
      orderBy: { verifiedAt: 'asc' },
    });

    const parClé = new Map<string, LigneRecette>();
    const parOffre = new Map<string, { planId: string; planName: string; nombre: number; montant: number }>();
    let total = 0;

    for (const p of paiements) {
      // `verifiedAt` ne peut pas être nul ici — le statut l'impose — mais le
      // type l'autorise, et un `!` masquerait le jour où ce ne serait plus vrai.
      if (!p.verifiedAt) continue;
      const montant = Number(p.amount);
      total += montant;

      const début = débutDeTranche(p.verifiedAt, pas).toISOString();
      const clé = `${début}|${p.planId}`;
      const ligne = parClé.get(clé) ?? {
        début,
        planId: p.planId,
        planName: p.plan.name,
        nombre: 0,
        montant: 0,
      };
      ligne.nombre += 1;
      ligne.montant += montant;
      parClé.set(clé, ligne);

      const cumul = parOffre.get(p.planId) ?? {
        planId: p.planId,
        planName: p.plan.name,
        nombre: 0,
        montant: 0,
      };
      cumul.nombre += 1;
      cumul.montant += montant;
      parOffre.set(p.planId, cumul);
    }

    return {
      // La devise est figée sur le paiement : celle du premier de la période
      // vaut pour l'ensemble, et un parc qui en mêlerait deux le montrerait.
      devise: paiements[0]?.currency ?? null,
      du: du.toISOString(),
      au: au.toISOString(),
      pas,
      total,
      nombre: paiements.length,
      lignes: [...parClé.values()].sort(
        (a, b) => a.début.localeCompare(b.début) || b.montant - a.montant,
      ),
      parOffre: [...parOffre.values()].sort((a, b) => b.montant - a.montant),
    };
  }

  /**
   * L'export comptable : une ligne par paiement, sur la période.
   *
   * Tous les statuts, et non les seuls vérifiés — un comptable veut voir ce
   * qui attend et ce qui a été refusé, pas seulement ce qui est entré. Le
   * statut est une colonne ; le filtre se fait dans le tableur.
   */
  async csv(du: Date, au: Date): Promise<string> {
    const paiements = await this.prisma.scoped.payment.findMany({
      where: { createdAt: { gte: du, lte: au } },
      select: {
        createdAt: true,
        verifiedAt: true,
        reference: true,
        method: true,
        status: true,
        amount: true,
        currency: true,
        customer: { select: { name: true, phone: true } },
        plan: { select: { name: true } },
        voucher: { select: { code: true } },
        subscriptionId: true,
        verifiedByAdmin: { select: { email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const entêtes = [
      'Date de déclaration',
      'Date de vérification',
      'Référence',
      'Méthode',
      'Statut',
      'Montant',
      'Devise',
      'Client',
      'Téléphone',
      'Offre',
      'Ticket',
      'Abonnement',
      'Vérifié par',
    ];

    const lignes = paiements.map((p) =>
      [
        p.createdAt.toISOString(),
        p.verifiedAt?.toISOString() ?? '',
        p.reference,
        p.method,
        p.status,
        // Point décimal : un tableur français le convertit, alors qu'une
        // virgule collée dans un champ non protégé casserait la colonne.
        Number(p.amount).toFixed(2),
        p.currency,
        p.customer.name,
        p.customer.phone,
        p.plan.name,
        // Vide quand le ticket a été purgé à trente jours : le paiement lui
        // survit, et c'est voulu.
        p.voucher?.code ?? '',
        p.subscriptionId ?? '',
        p.verifiedByAdmin?.email ?? '',
      ]
        .map(champCsv)
        .join(';'),
    );

    // BOM en tête : sans lui, Excel lit le CSV en ANSI et rend « Vérifié »
    // en « VÃ©rifiÃ© ». Le reste du monde l'ignore sans dommage.
    return `﻿${[entêtes.map(champCsv).join(';'), ...lignes].join('\r\n')}\r\n`;
  }
}
