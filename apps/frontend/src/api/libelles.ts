import type { PaymentMethod, PaymentStatus, VoucherStatus } from './types';

/**
 * Les mots que la console montre pour les valeurs que la base stocke.
 *
 * Un seul endroit, et c'est le point. Ces libellés vivaient dans les écrans
 * qui les affichaient : chacun retraduisait à sa façon, et ceux qu'on
 * regardait moins — la fiche client, la liste des offres — restaient en
 * anglais brut. Un vendeur y lisait `PENDING`, `SOLD`, `ORANGE_MONEY`.
 *
 * Le ton accompagne le libellé, parce que les deux se décident ensemble : un
 * statut rouge veut dire « quelque chose à faire », et se tromper de couleur
 * envoie chercher un problème qui n'existe pas.
 */
export type Ton = 'green' | 'amber' | 'red' | 'slate';
export interface Libellé {
  label: string;
  ton: Ton;
}

export const STATUT_TICKET: Record<VoucherStatus, Libellé> = {
  CREATED: { label: 'à vendre', ton: 'slate' },
  SOLD: { label: 'vendu', ton: 'amber' },
  ACTIVE: { label: 'en cours', ton: 'green' },
  // Expiré est l'issue normale d'un ticket vendu, pas un incident.
  EXPIRED: { label: 'expiré', ton: 'slate' },
  DISABLED: { label: 'coupé', ton: 'red' },
  CANCELLED: { label: 'annulé', ton: 'slate' },
};

/**
 * `GRACE` est la tolérance après l'échéance : l'abonné passe encore, mais il
 * doit. C'est le seul statut qui appelle un geste — d'où l'ambre.
 */
export const STATUT_ABONNEMENT: Record<string, Libellé> = {
  ACTIVE: { label: 'à jour', ton: 'green' },
  GRACE: { label: 'en tolérance', ton: 'amber' },
  SUSPENDED: { label: 'suspendu', ton: 'red' },
  CANCELLED: { label: 'résilié', ton: 'slate' },
};

export const STATUT_PAIEMENT: Record<PaymentStatus, Libellé> = {
  PENDING: { label: 'à vérifier', ton: 'amber' },
  VERIFIED: { label: 'vérifié', ton: 'green' },
  REJECTED: { label: 'refusé', ton: 'red' },
  // Ni l'un ni l'autre ne demandent quoi que ce soit : le rouge leur donnait
  // l'urgence d'un refus.
  CANCELLED: { label: 'annulé', ton: 'slate' },
  REFUNDED: { label: 'remboursé', ton: 'slate' },
};

/**
 * Les noms commerciaux, tels que le client les connaît.
 *
 * Passer par `méthodePaiement` plutôt que d'indexer : tous les écrans ne
 * typent pas ce champ, et un accès direct oblige à des conversions là où une
 * fonction suffit.
 */
export const METHODE_PAIEMENT: Record<PaymentMethod, string> = {
  CASH: 'Espèces',
  ORANGE_MONEY: 'Orange Money',
  MVOLA: 'MVola',
  AIRTEL_MONEY: 'Airtel Money',
  OTHER: 'Autre',
};

/** `ACTIVE` / `INACTIVE`, qui revient sur les offres et les clients. */
export const STATUT_SIMPLE: Record<string, Libellé> = {
  ACTIVE: { label: 'actif', ton: 'green' },
  INACTIVE: { label: 'inactif', ton: 'slate' },
  ARCHIVED: { label: 'archivé', ton: 'slate' },
  BLOCKED: { label: 'bloqué', ton: 'red' },
};

/**
 * Les types d'appareil, et ce qu'ils impliquent.
 *
 * Le ton n'est pas décoratif : **ambre pour la télévision et la caméra**, les
 * deux seuls types dépourvus de navigateur. Ils ne peuvent pas afficher le
 * portail captif et ne passeront jamais sans contournement ; c'est la raison
 * d'être de cet écran, et elle doit se voir dans la liste.
 */
export const TYPE_APPAREIL: Record<string, Libellé> = {
  PHONE: { label: 'téléphone', ton: 'slate' },
  COMPUTER: { label: 'ordinateur', ton: 'slate' },
  TV: { label: 'télévision', ton: 'amber' },
  CAMERA: { label: 'caméra', ton: 'amber' },
  ROUTER: { label: 'routeur', ton: 'slate' },
  // « Autre » est ce que rend la détection quand elle ne conclut pas : c'est
  // une absence de réponse, pas une catégorie.
  OTHER: { label: 'indéterminé', ton: 'slate' },
};

/**
 * Où en est un compte User Manager dans sa validité.
 *
 * RouterOS rend ces mots-là, et la console les recopiait tels quels : un
 * vendeur lisait `waiting` dans une colonne intitulée « État ». Aucun n'est
 * un incident — ils disent seulement où en est le compte — d'où l'ardoise
 * partout : le rouge est réservé à la suspension, qui est une décision.
 */
export const ETAT_COMPTE_UM: Record<string, Libellé> = {
  'running-active': { label: 'en cours', ton: 'green' },
  // Le forfait est allé au bout de sa validité : issue normale, pas panne.
  used: { label: 'consommé', ton: 'slate' },
  // Créé mais jamais utilisé : la validité n'a pas commencé à courir.
  waiting: { label: 'pas encore utilisé', ton: 'slate' },
  unknown: { label: 'sans profil', ton: 'slate' },
};

/**
 * Comment une session est entrée, et ce que ça change pour la couper.
 *
 * Ce n'est pas une curiosité technique. Une session entrée **par cookie** se
 * refait toute seule dès qu'on la ferme : le client n'a rien à taper, et le
 * routeur ne consulte même pas RADIUS. Sur ce parc, neuf sessions en cours
 * sur dix sont dans ce cas — relevé sur le routeur, pas supposé. « Déconnecter »
 * y est donc sans effet durable, et l'ambre est là pour le dire.
 */
export const ENTREE_SESSION: Record<string, Libellé> = {
  'mac-cookie': { label: 'cookie (adresse MAC)', ton: 'amber' },
  cookie: { label: 'cookie', ton: 'amber' },
  'http-pap': { label: 'code saisi', ton: 'green' },
  'http-chap': { label: 'code saisi', ton: 'green' },
  https: { label: 'code saisi', ton: 'green' },
  mac: { label: 'adresse MAC', ton: 'amber' },
  trial: { label: 'essai gratuit', ton: 'slate' },
};

/** Vrai quand fermer la session ne suffit pas : le client revient seul. */
export function revientSeul(loginBy: string): boolean {
  return loginBy.includes('cookie') || loginBy === 'mac';
}

/**
 * Traduit ce qui est connu, et **laisse passer le reste tel quel**.
 *
 * Un statut ajouté côté serveur sans l'être ici doit rester lisible, fût-ce
 * en anglais : afficher une case vide serait pire que d'afficher `REFUNDED`.
 */
export function libellé(table: Record<string, Libellé>, valeur: string): Libellé {
  return table[valeur] ?? { label: valeur, ton: 'slate' };
}

/** Même règle pour les moyens de paiement, qui n'ont pas de ton. */
export function méthodePaiement(valeur: string): string {
  return (METHODE_PAIEMENT as Record<string, string>)[valeur] ?? valeur;
}
