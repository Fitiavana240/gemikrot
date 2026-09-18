import {
  UserManagerLimitationDto,
  UserManagerProfileDto,
  UserManagerProfileLimitationDto,
  UserManagerSessionDto,
  UserManagerUserDto,
  UserManagerUserProfileDto,
  UserManagerUserProfileState,
} from '../dto/user-manager.dto';
import { formatRateToken, parseRouterOsDuration, splitRateLimitToken } from './hotspot.mapper';

// Les helpers de débit vivent dans `hotspot.mapper` (avec le parseur de
// durées) ; réexportés ici car le service les consomme depuis ce module.
export { formatRateToken };

export function mapUserManagerUser(raw: any): UserManagerUserDto {
  return {
    id: raw?.['.id'] ?? '',
    username: raw?.name ?? raw?.username ?? '',
    disabled: raw?.disabled === 'true' || raw?.disabled === true,
    sharedUsers: Number(raw?.['shared-users'] ?? 1),
    comment: raw?.comment ?? null,
    group: raw?.group ?? null,
  };
}

export function mapUserManagerProfile(raw: any): UserManagerProfileDto {
  const validity = raw?.validity;
  const sharedUsers = raw?.['override-shared-users'];

  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    nameForUsers: raw?.['name-for-users'] ?? null,
    comment: raw?.comment ?? null,
    // "unlimited" est une valeur légitime, à distinguer d'une durée nulle.
    validityDurationSeconds:
      validity == null || validity === 'unlimited' ? null : parseRouterOsDuration(validity),
    startsWhen: raw?.['starts-when'] === 'assigned' ? 'assigned' : 'first-auth',
    price: Number(raw?.price ?? 0),
    overrideSharedUsers:
      sharedUsers == null || sharedUsers === 'off' ? null : Number(sharedUsers) || null,
  };
}

export function mapUserManagerLimitation(raw: any): UserManagerLimitationDto {
  const rateLimit = splitRateLimitToken(raw?.['rate-limit']);

  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    rateLimit: { rxBitsPerSecond: rateLimit.rx, txBitsPerSecond: rateLimit.tx },
    transferLimitBytes: raw?.['transfer-limit'] != null ? Number(raw['transfer-limit']) : null,
    uptimeLimitSeconds:
      raw?.['uptime-limit'] != null ? parseRouterOsDuration(raw['uptime-limit']) : null,
  };
}

export function mapUserManagerProfileLimitation(raw: any): UserManagerProfileLimitationDto {
  return {
    id: raw?.['.id'] ?? '',
    profileName: raw?.profile ?? '',
    limitationName: raw?.limitation ?? '',
  };
}

/**
 * `end-time` n'est pas toujours une date : RouterOS renvoie `unlimited` pour
 * un profil sans échéance et `not-yet-running` tant que la validité
 * `first-auth` n'a pas démarré (le client ne s'est pas encore connecté).
 * Ces deux cas valent "pas d'échéance connue", et non une date invalide.
 */
export function mapUserManagerUserProfile(raw: any): UserManagerUserProfileDto {
  const rawEndTime = raw?.['end-time'];
  const endTime =
    rawEndTime == null ||
    rawEndTime === 'unlimited' ||
    rawEndTime === 'not-yet-running' ||
    Number.isNaN(Date.parse(String(rawEndTime)))
      ? null
      : String(rawEndTime);

  return {
    id: raw?.['.id'] ?? '',
    username: raw?.user ?? raw?.username ?? '',
    profileName: raw?.profile ?? '',
    endTime,
    state: mapUserProfileState(raw?.state),
  };
}

export function mapUserManagerSession(raw: any): UserManagerSessionDto {
  return {
    id: raw?.['.id'] ?? '',
    username: raw?.user ?? raw?.username ?? '',
    nasIpAddress: raw?.['nas-ip-address'] ?? null,
    callingStationId: raw?.['calling-station-id'] ?? null,
    startTime: raw?.['start-time'] ?? '',
    stopTime: raw?.['stop-time'] ?? null,
    sessionTimeSeconds: parseRouterOsDuration(raw?.['session-time']),
    bytesIn: Number(raw?.download ?? raw?.['bytes-in'] ?? 0),
    bytesOut: Number(raw?.upload ?? raw?.['bytes-out'] ?? 0),
    terminateCause: raw?.['terminate-cause'] ?? null,
  };
}

/** Valeurs relevées sur un hAP en 7.24.4 : `running-active`, `used`. */
function mapUserProfileState(state: unknown): UserManagerUserProfileState {
  switch (state) {
    case 'running-active':
      return 'running-active';
    case 'used':
      return 'used';
    case 'waiting':
      return 'waiting';
    default:
      return 'unknown';
  }
}

/** Durée applicative → notation RouterOS ("2592000" secondes → "30d"). */
export function formatValidity(seconds: number | null): string {
  if (seconds == null) return 'unlimited';
  return `${seconds}s`;
}
