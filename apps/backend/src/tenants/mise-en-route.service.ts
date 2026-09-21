import { Injectable } from '@nestjs/common';
import { PaymentStatus, PlanStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Les quatre pas qui séparent un compte neuf d'une première vente.
 *
 * Un exploitant qui vient de s'inscrire voit une console complète et vide.
 * Rien ne lui dit par où commencer, et l'ordre n'est pas indifférent : sans
 * routeur, une offre ne peut pas être poussée ; sans offre, aucun ticket ne
 * se génère ; sans puce, la page de paiement n'a aucun numéro à afficher et
 * le client ne peut pas payer.
 *
 * **Chaque étape est constatée, jamais déclarée.** On ne coche pas « routeur
 * connecté » parce qu'une ligne existe en base : on le coche parce que le
 * routeur a répondu. Une case cochée sur une intention serait pire que pas
 * de guide du tout — elle enverrait chercher la panne ailleurs.
 */

export interface ÉtapeMiseEnRoute {
  clé: 'routeur' | 'offres' | 'puce' | 'vente';
  titre: string;
  /** Ce qu'il faut faire, quand ce n'est pas fait. */
  aide: string;
  /** Où le faire. */
  lien: string;
  fait: boolean;
  /** Ce qu'on a constaté : « 3 offres », « jamais joint ». */
  constat: string;
}

export interface MiseEnRoute {
  étapes: ÉtapeMiseEnRoute[];
  faites: number;
  /** Vrai quand les quatre sont franchies : l'écran peut alors disparaître. */
  terminée: boolean;
}

@Injectable()
export class MiseEnRouteService {
  constructor(private readonly prisma: PrismaService) {}

  async etat(): Promise<MiseEnRoute> {
    const [routeurs, offres, puces, ventes] = await Promise.all([
      this.prisma.scoped.router.findMany({ select: { id: true, lastSeenAt: true } }),
      this.prisma.scoped.plan.count({ where: { status: PlanStatus.ACTIVE } }),
      this.prisma.scoped.mobileMoneyAccount.count({ where: { isActive: true } }),
      this.prisma.scoped.payment.count({ where: { status: PaymentStatus.VERIFIED } }),
    ]);

    // **A répondu au moins une fois**, et non « est enregistré ». Un routeur
    // déclaré mais jamais joint ne sert à rien, et cocher l'étape enverrait
    // chercher la panne ailleurs. `lastSeenAt` est la seule trace persistante
    // d'une réponse : l'état du disjoncteur, lui, vit en mémoire et repart à
    // zéro au redémarrage de l'application.
    const joints = routeurs.filter((r) => r.lastSeenAt != null);

    const étapes: ÉtapeMiseEnRoute[] = [
      {
        clé: 'routeur',
        titre: 'Raccorder un routeur',
        aide: "La console ne peut rien faire sans lui : c'est lui qui porte les comptes et applique les validités. Le raccordement se fait en collant un script dans le terminal de Winbox.",
        lien: '/routers',
        fait: joints.length > 0,
        constat:
          joints.length > 0
            ? `${joints.length} routeur(s) ayant répondu`
            : routeurs.length > 0
              ? `${routeurs.length} routeur(s) enregistré(s), aucun n’a encore répondu`
              : 'aucun routeur',
      },
      {
        clé: 'offres',
        titre: 'Créer vos offres',
        aide: 'Durée, prix, débit. Une offre créée ici crée aussi son profil sur le routeur : sans elle, aucun ticket ne peut être généré.',
        lien: '/plans',
        fait: offres > 0,
        constat: offres > 0 ? `${offres} offre(s) active(s)` : 'aucune offre',
      },
      {
        clé: 'puce',
        titre: 'Enregistrer une puce Mobile Money',
        aide: "C'est le numéro que verra le client sur la page de paiement. Sans lui, la page n'a rien à afficher et personne ne peut payer en ligne.",
        lien: '/settings',
        fait: puces > 0,
        constat: puces > 0 ? `${puces} puce(s) proposée(s)` : 'aucune puce',
      },
      {
        clé: 'vente',
        titre: 'Encaisser une première vente',
        aide: 'Générez un lot de tickets, vendez-en un, et vérifiez le paiement. C’est le parcours complet, de bout en bout.',
        lien: '/vouchers',
        fait: ventes > 0,
        constat: ventes > 0 ? `${ventes} paiement(s) vérifié(s)` : 'aucune vente',
      },
    ];

    const faites = étapes.filter((e) => e.fait).length;
    return { étapes, faites, terminée: faites === étapes.length };
  }
}
