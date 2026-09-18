import {
  ProfileStartsWhen,
  UserManagerLimitationDto,
  UserManagerProfileDto,
  UserManagerSessionDto,
  UserManagerUserDto,
  UserManagerUserProfileDto,
  UserManagerUserProfileState,
} from '../dto/user-manager.dto';
import { parseRouterOsDuration } from './hotspot.mapper';

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
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
  };
}

export function mapUserManagerLimitation(raw: any): UserManagerLimitationDto {
  const startsWhen: ProfileStartsWhen = raw?.['starts-when'] === 'logon' ? 'logon' : 'creation';
  const [rxToken, txToken] = String(raw?.['rate-limit'] ?? '').split('/');

  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    validityDurationSeconds: raw?.validity != null ? parseRouterOsDuration(raw.validity) : null,
    startsWhen,
    rateLimit: {
      rxBitsPerSecond: rxToken ? parseRateToken(rxToken) : null,
      txBitsPerSecond: txToken ? parseRateToken(txToken) : null,
    },
    transferLimitBytes: raw?.['transfer-limit'] != null ? Number(raw['transfer-limit']) : null,
    uptimeLimitSeconds: raw?.['uptime-limit'] != null ? parseRouterOsDuration(raw['uptime-limit']) : null,
  };
}

export function mapUserManagerUserProfile(raw: any): UserManagerUserProfileDto {
  return {
    id: raw?.['.id'] ?? '',
    username: raw?.user ?? raw?.username ?? '',
    profileName: raw?.profile ?? '',
    activatedAt: raw?.['activated-at'] ?? null,
    expiresAt: raw?.['expires-at'] ?? null,
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

function mapUserProfileState(state: unknown): UserManagerUserProfileState {
  switch (state) {
    case 'active':
      return 'active';
    case 'expired':
      return 'expired';
    case 'scheduled':
      return 'scheduled';
    default:
      return 'unknown';
  }
}

/** Convertit un token de rate-limit RouterOS (ex: "2M", "512k") en bits/s. */
function parseRateToken(token: string): number | null {
  const match = token.trim().match(/^([\d.]+)([kKmMgG]?)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : unit === 'g' ? 1_000_000_000 : 1;
  return Math.round(value * multiplier);
}

/** Opération inverse : bits/s applicatifs → token RouterOS ("2M", "512k"). */
export function formatRateToken(bitsPerSecond?: number): string | undefined {
  if (bitsPerSecond == null) return undefined;
  if (bitsPerSecond >= 1_000_000) return `${bitsPerSecond / 1_000_000}M`;
  if (bitsPerSecond >= 1_000) return `${bitsPerSecond / 1_000}k`;
  return `${bitsPerSecond}`;
}
