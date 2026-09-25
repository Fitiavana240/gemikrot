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
/** Une entree telle que le menu l'affiche : ouverte, ou fermee a clef. */
export interface NavItemAffiché extends NavItem {
  /** Visible, mais refusee a ce role. Le menu y met un cadenas. */
  verrouillé: boolean;
}

export interface NavGroupAffiché extends Omit<NavGroup, 'items'> {
  items: NavItemAffiché[];
}

/**
 * Cette entree appartient-elle au monde de cet utilisateur ?
 *
 * **Verrouiller et cacher ne disent pas la meme chose**, et c'est la seule
 * distinction qui compte ici.
 *
 * Un vendeur a qui l'on cache << Offres >> ne sait pas que la console sait
 * regler des offres : il croit le produit plus pauvre qu'il n'est, et ne
 * demande rien. Un cadenas lui dit que la chose existe et qu'elle appartient
 * a son exploitant -- il sait alors a qui s'adresser.
 *
 * Mais << Exploitants >> ou << Supervision >> n'appartiennent a aucun
 * exploitant : ce sont les ecrans de la plateforme. Y mettre un cadenas
 * reviendrait a annoncer a chaque client l'existence d'une console au-dessus
 * de la sienne, et le detail de ce qu'elle voit. Ceux-la restent caches.
 *
 * De meme << Mon abonnement >> pour un SUPER_ADMIN : il n'appartient a aucun
 * exploitant et n'a donc pas d'echeance. Ce n'est pas un refus, c'est une
 * question qui ne se pose pas.
 */
function appartientAuMonde(item: NavItem, role: AdminRole | undefined): boolean {
  if (!item.roles || !role) return true;
  const plateforme = item.roles.length === 1 && item.roles[0] === 'SUPER_ADMIN';
  if (plateforme) return role === 'SUPER_ADMIN';
  if (role === 'SUPER_ADMIN') return item.roles.includes('SUPER_ADMIN');
  return true;
}

/**
 * Le menu d'un role : ce qu'il ouvre, et ce qu'il voit sans pouvoir l'ouvrir.
 *
 * Les entrees refusees etaient **retirees** du menu. C'etait defendable --
 * offrir un bouton qui repondra 403 fait douter d'avoir mal fait. Mais cela
 * privait le vendeur de savoir ce que la console fait, et l'exploitant de
 * voir ce qu'il a delegue. Le cadenas dit les deux d'un coup : la chose
 * existe, elle n'est pas pour vous.
 *
 * La garde de route, elle, ne change pas : `rolesRequis` lit la meme
 * declaration et refuse toujours. Le cadenas n'ouvre rien.
 */
export function navPourRole(role: AdminRole | undefined): NavGroupAffiché[] {
  return NAV_GROUPS.map((groupe) => ({
    ...groupe,
    items: groupe.items
      .filter((item) => appartientAuMonde(item, role))
      .map((item) => ({
        ...item,
        verrouillé: Boolean(item.roles) && !(role && item.roles!.includes(role)),
      })),
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
