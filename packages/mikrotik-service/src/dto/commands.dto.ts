export interface CreateUserManagerUserDto {
  username: string;
  password: string;
  sharedUsers?: number;
  comment?: string;
  group?: string;
}

export interface CreateProfileDto {
  name: string;
  validityDurationSeconds: number;
  startsWhen: 'logon' | 'creation';
  rateLimitRxBitsPerSecond?: number;
  rateLimitTxBitsPerSecond?: number;
  transferLimitBytes?: number;
  sharedUsers?: number;
}

export interface UpdateProfileDto {
  /** Nom du profil à modifier (identifiant métier). */
  name: string;
  validityDurationSeconds?: number;
  startsWhen?: 'logon' | 'creation';
  rateLimitRxBitsPerSecond?: number;
  rateLimitTxBitsPerSecond?: number;
  transferLimitBytes?: number;
  sharedUsers?: number;
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
