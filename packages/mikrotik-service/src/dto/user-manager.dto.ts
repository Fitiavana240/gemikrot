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
