export interface UserManagerUserDto {
  id: string;
  username: string;
  disabled: boolean;
  sharedUsers: number;
  comment: string | null;
  group: string | null;
}

export interface UserManagerProfileDto {
  id: string;
  name: string;
}

export interface RateLimitDto {
  rxBitsPerSecond: number | null;
  txBitsPerSecond: number | null;
}

export type ProfileStartsWhen = 'logon' | 'creation';

/**
 * Correspond à un `profile-limitation` RouterOS : c'est ici que vivent
 * validity, starts-when et les limites RX/TX (objectifs 8, 9, 10 du cahier
 * des charges applicatif).
 */
export interface UserManagerLimitationDto {
  id: string;
  name: string;
  validityDurationSeconds: number | null;
  startsWhen: ProfileStartsWhen;
  rateLimit: RateLimitDto;
  transferLimitBytes: number | null;
  uptimeLimitSeconds: number | null;
}

export type UserManagerUserProfileState = 'active' | 'expired' | 'scheduled' | 'unknown';

/** Association utilisateur ↔ profil, porteuse de la date d'expiration réelle. */
export interface UserManagerUserProfileDto {
  id: string;
  username: string;
  profileName: string;
  activatedAt: string | null;
  expiresAt: string | null;
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
}
