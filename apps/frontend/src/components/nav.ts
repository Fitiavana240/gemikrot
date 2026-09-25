import type { AdminRole } from '../api/types';
import {
  IconeAppareil,
  IconeBillet,
  IconeCalendrier,
  IconeCarte,
  IconeClients,
  IconeCourbe,
  IconeDiagnostic,
  IconeEquipe,
  IconeEtiquette,
  IconeImmeuble,
  IconeJauge,
  IconeJournal,
  IconeLiaison,
  IconeOndes,
  IconePouls,
  IconeRecu,
  IconeReglages,
  IconeRouteur,
  IconeSupervision,
  IconeTicket,
  type Icône,
} from './icones';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  /** Absent : visible de tous les rôles connectés. */
  roles?: AdminRole[];
  /** Phrase d'aide au survol, pour qui découvre la console. */
  hint?: string;
  /**
   * L'icône de la ligne.
   *
   * **Elle accompagne le libellé, elle ne le remplace jamais.** Une icône se
   * reconnaît moins bien qu'on ne le croit, et la console se lit en français
   * par des gens qui n'ont pas grandi avec ces conventions. Ce qu'elle
   * apporte, c'est de retrouver une ligne déjà connue sans la relire — le
   * geste qu'on fait vingt fois par jour.
   */
  icone: Icône;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const ADMIN: AdminRole[] = ['ADMIN', 'SUPER_ADMIN'];

/**
 * Ce que le superviseur ne voit pas, et pourquoi.
 *
 * Un OPERATOR voyait HotSpot, User Manager, PPPoE, Offres et Routeurs dans le
 * menu, et recevait un refus sur chacun : le serveur les reserve depuis
 * toujours aux administrateurs. Offrir un bouton qui repondra 403 est pire
 * que ne rien offrir — on croit avoir mal fait, on recommence, on appelle.
 *
 * Le decoupage suit celui du serveur, et non l'inverse : **vendre et suivre**
 * d'un cote, **configurer le materiel** de l'autre. C'est aussi la promesse
 * faite a l'exploitant qui delegue son comptoir : son vendeur ne peut rien
 * casser sur le routeur.
 */

/**
 * La navigation, groupée par **ce qu'on vient faire** plutôt que par entité
 * technique.
 *
 * Quatorze entrées à plat obligeaient à lire toute la liste pour en trouver
 * une, et ne disaient rien de ce qui va ensemble. Un vendeur passe sa journée
 * dans « Vendre » et n'ouvre jamais « Réseau » ; un administrateur fait
 * l'inverse. Le regroupement rend cette différence visible au lieu de la
 * laisser deviner.
 *
 * L'ordre suit la fréquence d'usage, pas l'importance : ce qu'on ouvre vingt
 * fois par jour vient avant ce qu'on règle une fois par mois.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'vente',
    label: 'Vendre',
    items: [
      { to: '/', icone: IconeJauge, label: "Vue d'ensemble", end: true, hint: 'Ventes du jour et état du réseau' },
      {
        to: '/vouchers', icone: IconeTicket,
        label: 'Tickets',
        hint: 'Générer, suivre les lots, imprimer, couper',
      },
      { to: '/payments', icone: IconeBillet, label: 'Paiements', hint: 'Encaissements et validations' },
      { to: '/recettes', icone: IconeCourbe, label: 'Recettes', hint: 'Ce qui rentre, par offre et par période' },
    ],
  },
  {
    id: 'clients',
    label: 'Clients',
    items: [
      { to: '/customers', icone: IconeClients, label: 'Répertoire', hint: 'Fiches clients' },
      { to: '/subscriptions', icone: IconeCalendrier, label: 'Abonnements', hint: 'Échéances, suspensions, reprises' },
      { to: '/devices', icone: IconeAppareil, label: 'Appareils', hint: 'Contournements du portail captif' },
    ],
  },
  {
    id: 'reseau',
    label: 'Réseau',
    items: [
      { to: '/sessions', icone: IconePouls, label: 'Connectés', hint: 'Qui est en ligne en ce moment' },
      {
        to: '/routers', icone: IconeRouteur,
        label: 'Routeurs',
        roles: ADMIN,
        hint: 'Joignabilité, raccordement, import',
      },
      {
        to: '/diagnostic', icone: IconeDiagnostic,
        label: 'Diagnostic',
        roles: ADMIN,
        hint: 'Débit par client, interfaces, journal du routeur, accès',
      },
    ],
  },
  {
    id: 'mikrotik',
    label: 'Configuration MikroTik',
    items: [
      {
        to: '/hotspot', icone: IconeOndes,
        label: 'HotSpot',
        roles: ADMIN,
        hint: 'Serveurs, comptes, hôtes, walled garden, cookies',
      },
      {
        to: '/user-manager', icone: IconeCarte,
        label: 'User Manager',
        roles: ADMIN,
        hint: 'Comptes, profils, limitations, sessions, RADIUS',
      },
      {
        to: '/pppoe', icone: IconeLiaison,
        label: 'PPPoE',
        roles: ADMIN,
        hint: "L'abonné raccordé à demeure : comptes, profils, serveurs, bassins",
      },
    ],
  },
  {
    id: 'reglages',
    label: 'Réglages',
    items: [
      { to: '/plans', icone: IconeEtiquette, label: 'Offres', roles: ADMIN, hint: 'Durées, prix, débits' },
      // Le modele de ticket a rejoint Parametres : on n'y touche qu'une fois,
      // c'est un reglage, et il se cherche la ou on range les reglages.
      {
        to: '/settings', icone: IconeReglages,
        label: 'Paramètres',
        hint: 'Marque, paiement, tickets, portail, apparence',
      },
      {
        to: '/equipe', icone: IconeEquipe,
        label: 'Équipe',
        roles: ADMIN,
        hint: 'Donner la console à un superviseur, sans lui prêter votre mot de passe',
      },
      {
        // Reserve a l'ADMIN seul : le SUPER_ADMIN n'appartient a aucun
        // exploitant, et n'a donc pas d'abonnement a lui.
        to: '/abonnement', icone: IconeRecu,
        label: 'Mon abonnement',
        roles: ['ADMIN'],
        hint: "Échéance, tarifs, ce qui se ferme si rien n'est payé",
      },
      { to: '/audit', icone: IconeJournal, label: 'Journal', roles: ADMIN, hint: 'Qui a fait quoi, et quand' },
      {
        to: '/supervision', icone: IconeSupervision,
        label: 'Supervision',
        roles: ['SUPER_ADMIN'],
        hint: 'Qui vend, qui est en panne, qui doit',
      },
      { to: '/tenants', icone: IconeImmeuble, label: 'Exploitants', roles: ['SUPER_ADMIN'], hint: 'Comptes de la plateforme' },
    ],
  },
];

/**
 * Retire ce que le rôle n'a pas le droit de voir, puis les groupes devenus
 * vides. Offrir un bouton qui répondra 403 est pire que ne rien offrir.
 */
export function navPourRole(role: AdminRole | undefined): NavGroup[] {
  return NAV_GROUPS.map((groupe) => ({
    ...groupe,
    items: groupe.items.filter((item) => !item.roles || (role && item.roles.includes(role))),
  })).filter((groupe) => groupe.items.length > 0);
}

/** Le groupe auquel appartient une adresse, pour l'ouvrir à l'arrivée. */
export function groupeDe(chemin: string): string | undefined {
  return NAV_GROUPS.find((groupe) =>
    groupe.items.some((item) => (item.end ? chemin === item.to : chemin.startsWith(item.to))),
  )?.id;
}

/**
 * Les roles admis sur une adresse, d'apres la navigation elle-meme.
 *
 * **Une seule liste**, et c'est tout l'interet : la garde de route et le menu
 * lisent la meme declaration. Deux listes divergeraient des la premiere
 * entree ajoutee, et la divergence se verrait du mauvais cote — un ecran
 * atteignable qu'on croyait ferme.
 *
 * `undefined` = ouvert a tout compte connecte.
 */
export function rolesRequis(chemin: string): AdminRole[] | undefined {
  // Le chemin le plus long d'abord : `/settings/portail` doit trouver
  // `/settings`, et non `/` qui commence pourtant toute adresse.
  const candidats = NAV_GROUPS.flatMap((g) => g.items)
    .filter((item) => (item.end ? chemin === item.to : chemin.startsWith(item.to)))
    .sort((a, b) => b.to.length - a.to.length);
  return candidats[0]?.roles;
}
