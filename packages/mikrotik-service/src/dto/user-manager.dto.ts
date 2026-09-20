export interface UserManagerUserDto {
  id: string;
  username: string;
  disabled: boolean;
  sharedUsers: number;
  comment: string | null;
  group: string | null;
}

export interface RateLimitDto {
  rxBitsPerSecond: number | null;
  txBitsPerSecond: number | null;
}

/**
 * Quand la validité démarre, valeurs telles que RouterOS les nomme :
 *  - `first-auth` : à la première authentification du client — c'est ce qui
 *    permet de vendre « un mois » sans que le compte s'use avant usage ;
 *  - `assigned` : dès l'attribution du profil.
 */
export type ProfileStartsWhen = 'first-auth' | 'assigned';

/**
 * Offre User Manager (`/user-manager/profile`). Contrairement au HotSpot dont
 * le `session-timeout` ne borne qu'une session, `validity` est une durée
 * **calendaire** : c'est ce qui rend User Manager adapté aux abonnements.
 */
export interface UserManagerProfileDto {
  id: string;
  name: string;
  nameForUsers: string | null;
  comment: string | null;
  /** `null` quand la validité est illimitée. */
  validityDurationSeconds: number | null;
  startsWhen: ProfileStartsWhen;
  /** Prix porté par le profil côté routeur, dans l'unité de l'exploitant. */
  price: number;
  /** `null` quand `override-shared-users` vaut `off`. */
  overrideSharedUsers: number | null;
}

/**
 * Limitation de débit/quota (`/user-manager/limitation`), rattachée à un
 * profil via `/user-manager/profile-limitation`. Distincte de la validité,
 * qui vit sur le profil lui-même.
 */
export interface UserManagerLimitationDto {
  id: string;
  name: string;
  rateLimit: RateLimitDto;
  transferLimitBytes: number | null;
  uptimeLimitSeconds: number | null;
}

/** Jonction profil ↔ limitation. */
export interface UserManagerProfileLimitationDto {
  id: string;
  profileName: string;
  limitationName: string;
}

/** États réellement renvoyés par RouterOS pour une attribution de profil. */
export type UserManagerUserProfileState = 'running-active' | 'used' | 'waiting' | 'unknown';

/**
 * Abonnement en cours : l'attribution d'un profil à un utilisateur
 * (`/user-manager/user-profile`). `endTime` est calculé et tenu par le
 * routeur — c'est la source de vérité de l'échéance, y compris si
 * l'application est arrêtée.
 */
export interface UserManagerUserProfileDto {
  id: string;
  username: string;
  profileName: string;
  /** `null` quand l'échéance est illimitée ou pas encore démarrée. */
  endTime: string | null;
  state: UserManagerUserProfileState;
  /**
   * Vrai quand l'attribution désigne un compte qui n'existe plus.
   *
   * RouterOS résout la référence en nom tant que le compte existe, et rend
   * l'identifiant brut — `*10` — quand il a disparu. Relevé sur le hAP en
   * 7.24.4 : dix-huit attributions ont survécu à leurs comptes, et la console
   * affichait `*10` dans la colonne « Compte » comme si c'était un nom.
   */
  usernameIntrouvable: boolean;
}

export interface UserManagerSessionDto {
  id: string;
  username: string;
  nasIpAddress: string | null;
  callingStationId: string | null;
  startTime: string;
  stopTime: string | null;
  sessionTimeSeconds: number;
  bytesIn: number;
  bytesOut: number;
  terminateCause: string | null;
  /** Porté par le routeur, pas déduit d'une date de fin manquante. */
  active: boolean;
}

/**
 * Un paiement enregistré par User Manager — `/user-manager/payment`.
 *
 * **Noms de champs non vérifiés sur matériel.** La collection existe et
 * répond `200`, mais elle est vide sur le parc : la fonction de paiement
 * intégrée de RouterOS n'y est pas utilisée, l'encaissement passant par
 * Mobile Money hors du routeur. Les champs ci-dessous sont déduits des
 * colonnes de WinBox, pas d'un relevé — même situation que `/ppp/active`, et
 * l'écran le dit plutôt que de laisser croire.
 *
 * À ne pas confondre avec les paiements de l'application, qui sont la source
 * de vérité commerciale : ceci n'est que ce que le routeur a noté lui-même.
 */
export interface UserManagerPaymentDto {
  id: string;
  username: string;
  profileName: string | null;
  /** Tel que le routeur l'écrit, sans conversion de devise. */
  price: string | null;
  currency: string | null;
  transactionStart: string | null;
  transactionEnd: string | null;
  transactionStatus: string | null;
}
