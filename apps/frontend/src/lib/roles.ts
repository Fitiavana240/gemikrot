import type { AdminRole } from '../api/types';

/**
 * Ce que chaque rôle est, dit en français.
 *
 * La console affichait `OPERATOR` et `VIEWER` tels quels, en majuscules
 * anglaises, à des gens qui vendent des tickets à Toliara. Un rôle qu'on ne
 * comprend pas est un rôle qu'on n'attribue pas — l'exploitant finissait par
 * prêter son propre mot de passe à son vendeur, et le journal enregistrait
 * alors tout sous son nom à lui.
 *
 * Les noms sont ceux du métier, pas ceux du code : **superviseur** est le mot
 * qu'emploie l'exploitant pour la personne qui tient le comptoir à sa place.
 */

export interface DescriptionRole {
  /** Le nom qui s'affiche partout dans la console. */
  nom: string;
  /** Ce que la personne peut faire, en une phrase. */
  resume: string;
  /** Ce qu'elle ne peut pas faire — souvent plus utile que l'inverse. */
  limite: string;
}

export const ROLES: Record<AdminRole, DescriptionRole> = {
  SUPER_ADMIN: {
    nom: 'Plateforme',
    resume: "Supervise les exploitants, leurs abonnements et l'état de leurs routeurs.",
    limite: "N'appartient à aucun exploitant : pour agir sur un parc, il doit en cibler un.",
  },
  ADMIN: {
    nom: 'Administrateur',
    resume:
      'Tout : la configuration du routeur, les offres, les tarifs, le portail captif, les comptes.',
    limite: "C'est le seul rôle qui peut toucher au matériel et créer d'autres comptes.",
  },
  OPERATOR: {
    nom: 'Superviseur',
    resume:
      'Vend et suit : tickets, paiements, clients, abonnements, appareils, sessions en cours.',
    limite:
      "Ne voit ni la configuration MikroTik, ni les offres, ni le journal : il ne peut rien casser sur le routeur.",
  },
  VIEWER: {
    nom: 'Lecture seule',
    resume: 'Consulte tout ce que voit un superviseur, sans jamais rien modifier.',
    limite: 'Aucun bouton qui écrit ne lui est proposé.',
  },
};

/** Le nom lisible d'un rôle, ou le code brut si un jour il en apparaît un autre. */
export function nomDuRole(role: AdminRole | undefined | null): string {
  if (!role) return '—';
  return ROLES[role]?.nom ?? role;
}

/** Les rôles qu'un exploitant peut attribuer. Il délègue, il ne se clone pas. */
export const ROLES_DELEGABLES: ('OPERATOR' | 'VIEWER')[] = ['OPERATOR', 'VIEWER'];
