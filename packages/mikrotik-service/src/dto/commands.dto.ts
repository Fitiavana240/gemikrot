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
