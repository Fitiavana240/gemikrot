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
  uptimeLimitSeconds?: number | null;
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
}

export interface UpdateHotspotUserDto {
  username: string;
  profileName?: string;
  password?: string;
  comment?: string;
}

export interface CreateHotspotProfileDto {
  name: string;
  rateLimitRxBitsPerSecond?: number;
  rateLimitTxBitsPerSecond?: number;
  sessionTimeoutSeconds?: number;
  sharedUsers?: number;
}

export interface UpdateHotspotProfileDto {
  /** Nom du profil à modifier (identifiant métier côté RouterOS). */
  name: string;
  rateLimitRxBitsPerSecond?: number;
  rateLimitTxBitsPerSecond?: number;
  sessionTimeoutSeconds?: number;
  sharedUsers?: number;
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
