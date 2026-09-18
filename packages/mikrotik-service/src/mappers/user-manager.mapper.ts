import {
  UserManagerLimitationDto,
  UserManagerProfileDto,
  UserManagerProfileLimitationDto,
  UserManagerSessionDto,
  UserManagerUserDto,
  UserManagerUserProfileDto,
  UserManagerUserProfileState,
} from '../dto/user-manager.dto';
import { formatRateToken, parseRateToken, parseRouterOsDuration } from './hotspot.mapper';

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

/**
 * Une limitation ne porte pas de jeton `rate-limit` « rx/tx » comme un profil
 * HotSpot : RouterOS expose deux champs distincts, `rate-limit-rx` et
 * `rate-limit-tx`, en bits par seconde. Relevé sur un hAP en 7.24.4 — la
 * lecture d'un `rate-limit` inexistant renvoyait silencieusement deux `null`.
 *
 * Zéro est la valeur par défaut de RouterOS pour « aucune limite » : elle est
 * ramenée à `null`, pour ne pas la confondre avec un plafond réel de 0 bit/s.
 */
export function mapUserManagerLimitation(raw: any): UserManagerLimitationDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    rateLimit: {
      rxBitsPerSecond: parsePositiveAmount(raw?.['rate-limit-rx']),
      txBitsPerSecond: parsePositiveAmount(raw?.['rate-limit-tx']),
    },
    transferLimitBytes: parsePositiveAmount(raw?.['transfer-limit']),
    uptimeLimitSeconds: parsePositiveDuration(raw?.['uptime-limit']),
  };
}

/** Accepte aussi bien `"2000000"` que `"2M"` : RouterOS lit les deux. */
function parsePositiveAmount(value: unknown): number | null {
  if (value == null || value === '' || value === 'unlimited') return null;
  const parsed = parseRateToken(String(value));
  return parsed && parsed > 0 ? parsed : null;
}

function parsePositiveDuration(value: unknown): number | null {
  if (value == null || value === '' || value === 'unlimited') return null;
  const seconds = parseRouterOsDuration(value);
  return seconds > 0 ? seconds : null;
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
