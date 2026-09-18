import { HotspotActiveUserDto, HotspotHostDto, HotspotProfileDto, HotspotUserDto } from '../dto/hotspot.dto';

export function mapHotspotActiveUser(raw: any): HotspotActiveUserDto {
  return {
    id: raw?.['.id'] ?? '',
    username: raw?.user ?? '',
    address: raw?.address ?? '',
    macAddress: raw?.['mac-address'] ?? '',
    uptimeSeconds: parseRouterOsDuration(raw?.uptime),
    sessionTimeLeftSeconds:
      raw?.['session-time-left'] != null ? parseRouterOsDuration(raw['session-time-left']) : null,
    idleTimeSeconds: parseRouterOsDuration(raw?.['idle-time']),
    bytesIn: Number(raw?.['bytes-in'] ?? 0),
    bytesOut: Number(raw?.['bytes-out'] ?? 0),
    loginBy: raw?.['login-by'] ?? '',
  };
}

export function mapHotspotHost(raw: any): HotspotHostDto {
  return {
    id: raw?.['.id'] ?? '',
    macAddress: raw?.['mac-address'] ?? '',
    address: raw?.address ?? '',
    toAddress: raw?.['to-address'] ?? null,
    server: raw?.server ?? '',
    idleTimeSeconds: parseRouterOsDuration(raw?.['idle-time']),
    bypassed: raw?.bypassed === 'true' || raw?.bypassed === true,
    authorized: raw?.authorized === 'true' || raw?.authorized === true,
  };
}

export function mapHotspotUser(raw: any): HotspotUserDto {
  return {
    id: raw?.['.id'] ?? '',
    username: raw?.name ?? '',
    profile: raw?.profile ?? '',
    disabled: raw?.disabled === 'true' || raw?.disabled === true,
    comment: raw?.comment ?? null,
    limitUptimeSeconds: raw?.['limit-uptime'] != null ? parseRouterOsDuration(raw['limit-uptime']) : null,
    limitBytesIn: raw?.['limit-bytes-in'] != null ? Number(raw['limit-bytes-in']) : null,
    limitBytesOut: raw?.['limit-bytes-out'] != null ? Number(raw['limit-bytes-out']) : null,
  };
}

export function mapHotspotProfile(raw: any): HotspotProfileDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    rateLimit: raw?.['rate-limit'] ?? null,
    sessionTimeoutSeconds: raw?.['session-timeout'] != null ? parseRouterOsDuration(raw['session-timeout']) : null,
    sharedUsers: Number(raw?.['shared-users'] ?? 1),
    idleTimeoutSeconds: raw?.['idle-timeout'] != null ? parseRouterOsDuration(raw['idle-timeout']) : null,
  };
}

/**
 * RouterOS exprime les durées sous la forme "1d02:03:04", "00:05:00" ou "45s".
 * Ce parseur est centralisé ici pour ne jamais être dupliqué ailleurs dans
 * la couche MikroTik.
 */
export function parseRouterOsDuration(value: unknown): number {
  if (value == null) return 0;
  const str = String(value).trim();

  const secondsOnlyMatch = str.match(/^(\d+)s$/);
  if (secondsOnlyMatch) return Number(secondsOnlyMatch[1]);

  const dayMatch = str.match(/^(\d+)d/);
  const days = dayMatch ? Number(dayMatch[1]) : 0;
  const timePart = str.includes('d') ? str.split('d')[1] : str;

  const [h = '0', m = '0', s = '0'] = timePart.split(':');
  const hours = Number(h) || 0;
  const minutes = Number(m) || 0;
  const seconds = Number(s) || 0;

  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}
