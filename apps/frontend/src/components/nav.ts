import type { AdminRole } from '../api/types';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  /** Absent : visible de tous les rôles connectés. */
  roles?: AdminRole[];
  /** Phrase d'aide au survol, pour qui découvre la console. */
  hint?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const ADMIN: AdminRole[] = ['ADMIN', 'SUPER_ADMIN'];

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
      { to: '/', label: "Vue d'ensemble", end: true, hint: 'Ventes du jour et état du réseau' },
      { to: '/vouchers', label: 'Tickets', hint: 'Générer, vendre, couper' },
      { to: '/batches', label: 'Lots', hint: 'Ce qui a été généré, et ce qu\'il en reste' },
      { to: '/ticket-print', label: 'Imprimer', hint: 'Planche de tickets à découper' },
      { to: '/payments', label: 'Paiements', hint: 'Encaissements et validations' },
    ],
  },
  {
    id: 'clients',
    label: 'Clients',
    items: [
      { to: '/customers', label: 'Répertoire', hint: 'Fiches clients' },
      { to: '/subscriptions', label: 'Abonnements', hint: 'Échéances, suspensions, reprises' },
      { to: '/devices', label: 'Appareils', hint: 'Contournements du portail captif' },
    ],
  },
  {
    id: 'reseau',
    label: 'Réseau',
    items: [
      { to: '/sessions', label: 'Connectés', hint: 'Qui est en ligne en ce moment' },
      { to: '/routers', label: 'Routeurs', hint: 'Joignabilité, raccordement, import' },
    ],
  },
  {
    id: 'mikrotik',
    label: 'Configuration MikroTik',
    items: [
      {
        to: '/hotspot',
        label: 'HotSpot',
        hint: 'Serveurs, comptes, hôtes, walled garden, cookies',
      },
      {
        to: '/user-manager',
        label: 'User Manager',
        hint: 'Comptes, profils, limitations, sessions, RADIUS',
      },
    ],
  },
  {
    id: 'reglages',
    label: 'Réglages',
    items: [
      { to: '/plans', label: 'Offres', hint: 'Durées, prix, débits' },
      { to: '/ticket-templates', label: 'Modèle de ticket', hint: "Mise en page de l'impression" },
      { to: '/settings', label: 'Paramètres', hint: 'Marque, Mobile Money, comptes' },
      { to: '/audit', label: 'Journal', roles: ADMIN, hint: 'Qui a fait quoi, et quand' },
      { to: '/tenants', label: 'Exploitants', roles: ['SUPER_ADMIN'], hint: 'Comptes de la plateforme' },
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
