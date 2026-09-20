export interface CreateUserManagerUserDto {
  username: string;
  password: string;
  sharedUsers?: number;
  comment?: string;
  group?: string;
}

/**
 * Offre User Manager. `validityDurationSeconds` est une durée **calendaire**
 * (null = illimitée), et non une durée de session comme côté HotSpot.
 */
export interface CreateProfileDto {
  name: string;
  validityDurationSeconds: number | null;
  startsWhen: 'first-auth' | 'assigned';
  price?: number;
  nameForUsers?: string;
  /** `override-shared-users` : nombre d'appareils simultanés autorisés. */
  sharedUsers?: number;
  comment?: string;
}

export interface UpdateProfileDto {
  /** Nom du profil à modifier (identifiant métier). */
  name: string;
  validityDurationSeconds?: number | null;
  startsWhen?: 'first-auth' | 'assigned';
  price?: number;
  nameForUsers?: string;
  sharedUsers?: number;
  comment?: string;
}

export interface UpdateUserManagerUserDto {
  /** Compte à modifier (identifiant métier). */
  username: string;
  password?: string;
  sharedUsers?: number;
  comment?: string;
  group?: string;
}

/**
 * Plafonds de débit et de volume (`/user-manager/limitation`). Séparés du
 * profil, qui ne porte que la validité : une même limitation peut être
 * rattachée à plusieurs offres.
 *
 * `null` sur un plafond = aucune limite (RouterOS stocke zéro).
 */
export interface CreateLimitationDto {
  name: string;
  rateLimitRxBitsPerSecond?: number | null;
  rateLimitTxBitsPerSecond?: number | null;
  transferLimitBytes?: number | null;
  downloadLimitBytes?: number | null;
  uploadLimitBytes?: number | null;
  uptimeLimitSeconds?: number | null;
  /** `null` rend le quota définitif ; une durée le fait repartir à zéro. */
  resetCountersIntervalSeconds?: number | null;
  /** `AAAA-MM-JJ HH:MM:SS`, la forme que RouterOS écrit lui-même. */
  resetCountersStartTime?: string | null;
}

export interface UpdateLimitationDto extends Partial<CreateLimitationDto> {
  /** Limitation à modifier (identifiant métier). */
  name: string;
}

/** Rattachement d'une limitation à une offre (`/user-manager/profile-limitation`). */
export interface AttachLimitationDto {
  profileName: string;
  limitationName: string;
}

export interface AssignProfileDto {
  username: string;
  profileName: string;
}

export interface RemoveProfileAssignmentDto {
  username: string;
  profileName: string;
}

export interface DisconnectHotspotUserDto {
  sessionId: string;
}

// ---------- HotSpot local (`/ip/hotspot/...`) ----------
// C'est la base réellement utilisée en production : comptes nommés, profils
// tarifaires et contournements d'appareils. User Manager reste disponible via
// les DTOs ci-dessus pour une bascule ultérieure.

export interface CreateHotspotUserDto {
  username: string;
  password: string;
  profileName: string;
  server?: string;
  comment?: string;
  /**
   * Plafond de temps cumulé du compte — `limit-uptime` côté RouterOS.
   *
   * C'est ainsi que le parc vend ses tickets courts : 400 de ses 646 comptes
   * en portent un, `2h` pour un ticket à 500 Ar. À ne pas confondre avec la
   * validité d'un profil User Manager, qui est **calendaire** : celle-ci
   * s'écoule même client déconnecté, celui-là ne compte que les sessions.
   */
  limitUptimeSeconds?: number | null;
  /**
   * Quotas du **compte**, posés ticket par ticket.
   *
   * Ils ne découlent pas du profil : celui-ci borne une session, ceux-ci
   * bornent l'accès vendu.
   */
  limitBytesIn?: number | null;
  limitBytesOut?: number | null;
  limitBytesTotal?: number | null;
}

export interface UpdateHotspotUserDto {
  username: string;
  profileName?: string;
  password?: string;
  comment?: string;
  server?: string;
  /** `null` retire le plafond ; absent ne touche à rien. */
  limitUptimeSeconds?: number | null;
  /**
   * Quotas du **compte**, posés ticket par ticket.
   *
   * Ils ne découlent pas du profil : celui-ci borne une session, ceux-ci
   * bornent l'accès vendu. `null` retire le plafond, absent n'y touche pas.
   */
  limitBytesIn?: number | null;
  limitBytesOut?: number | null;
  limitBytesTotal?: number | null;
}

export interface CreateHotspotProfileDto {
  name: string;
  rateLimitRxBitsPerSecond?: number;
  rateLimitTxBitsPerSecond?: number;
  sessionTimeoutSeconds?: number;
  sharedUsers?: number;
  idleTimeoutSeconds?: number | null;
  keepaliveTimeoutSeconds?: number | null;
  /**
   * Poser un cookie à la connexion, ou non.
   *
   * Le couper rend le blocage d'un compte immédiat — plus personne ne
   * rentre sans repasser par RADIUS — au prix d'une saisie du code à chaque
   * reconnexion. C'est un arbitrage commercial, pas un réglage technique :
   * l'écrire dans l'interface plutôt que de le laisser à WinBox.
   */
  addMacCookie?: boolean;
  macCookieTimeoutSeconds?: number | null;
}

export interface UpdateHotspotProfileDto {
  /** Nom du profil à modifier (identifiant métier côté RouterOS). */
  name: string;
  rateLimitRxBitsPerSecond?: number;
  rateLimitTxBitsPerSecond?: number;
  sessionTimeoutSeconds?: number;
  sharedUsers?: number;
  idleTimeoutSeconds?: number | null;
  keepaliveTimeoutSeconds?: number | null;
  /**
   * Poser un cookie à la connexion, ou non.
   *
   * Le couper rend le blocage d'un compte immédiat — plus personne ne
   * rentre sans repasser par RADIUS — au prix d'une saisie du code à chaque
   * reconnexion. C'est un arbitrage commercial, pas un réglage technique :
   * l'écrire dans l'interface plutôt que de le laisser à WinBox.
   */
  addMacCookie?: boolean;
  macCookieTimeoutSeconds?: number | null;
}

export interface CreateIpBindingDto {
  macAddress: string;
  type: 'regular' | 'bypassed' | 'blocked';
  server?: string;
  address?: string;
  comment?: string;
}

/** Ouverture d'un domaine avant authentification. */
export interface CreateWalledGardenEntryDto {
  dstHost: string;
  action?: 'allow' | 'deny';
  dstPort?: string;
  comment?: string;
}

/** Ouverture d'une adresse avant authentification. */
export interface CreateWalledGardenIpEntryDto {
  dstAddress: string;
  action?: 'accept' | 'drop' | 'reject';
  dstPort?: string;
  protocol?: string;
  comment?: string;
}

/**
 * Création d'un abonné PPPoE. Le débit ne se règle pas ici : il vit sur le
 * profil, que ce compte désigne par son nom.
 */
export interface CreatePppSecretDto {
  username: string;
  password: string;
  /** Nom d'un profil existant. Sans lui, RouterOS applique `default`. */
  profile?: string;
  /** `pppoe` par défaut ; `any` accepte tous les services. */
  service?: string;
  /** Adresse imposée à cet abonné, au lieu du bassin du profil. */
  remoteAddress?: string;
  comment?: string;
}

/**
 * Modification d'un compte PPPoE.
 *
 * Pas de `username` : il identifie le compte. Le changer reviendrait à en
 * créer un autre, en perdant l'historique du premier — RouterOS ne suit pas
 * les renommages.
 *
 * Tout est facultatif, et **seuls les champs fournis sont écrits**. Un
 * formulaire qui renverrait l'objet entier écraserait au passage ce que
 * quelqu'un d'autre a réglé entre-temps.
 */
export interface UpdatePppSecretDto {
  password?: string;
  profile?: string;
  service?: string;
  remoteAddress?: string;
  comment?: string;
}
