import {
  DhcpLeaseDto,
  HotspotActiveUserDto,
  HotspotCookieDto,
  HotspotHostDto,
  HotspotProfileDto,
  HotspotUserDto,
  HotspotServerDto,
  HotspotServerProfileDto,
  IpBindingDto,
  IpBindingType,
  WalledGardenEntryDto,
  WalledGardenIpEntryDto,
} from '../dto/hotspot.dto';

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
    server: raw?.server ?? null,
    bytesIn: Number(raw?.['bytes-in'] ?? 0),
    bytesOut: Number(raw?.['bytes-out'] ?? 0),
    // Duree RouterOS (« 5d4h44m52s »), pas un nombre de secondes.
    uptimeSeconds: parseRouterOsDuration(raw?.uptime),
    limitUptimeSeconds: raw?.['limit-uptime'] != null ? parseRouterOsDuration(raw['limit-uptime']) : null,
    limitBytesIn: raw?.['limit-bytes-in'] != null ? Number(raw['limit-bytes-in']) : null,
    limitBytesTotal: raw?.['limit-bytes-total'] != null ? Number(raw['limit-bytes-total']) : null,
    limitBytesOut: raw?.['limit-bytes-out'] != null ? Number(raw['limit-bytes-out']) : null,
  };
}

export function mapHotspotCookie(raw: any): HotspotCookieDto {
  return {
    id: raw?.['.id'] ?? '',
    username: raw?.user ?? '',
    macAddress: raw?.['mac-address'] ?? '',
    expiresInSeconds: parseRouterOsDuration(raw?.['expires-in']),
  };
}

export function mapIpBinding(raw: any): IpBindingDto {
  const rawType = String(raw?.type ?? 'regular');
  const type: IpBindingType =
    rawType === 'bypassed' || rawType === 'blocked' ? rawType : 'regular';

  return {
    id: raw?.['.id'] ?? '',
    macAddress: raw?.['mac-address'] ?? '',
    address: raw?.address ?? null,
    toAddress: raw?.['to-address'] ?? null,
    type,
    server: raw?.server ?? null,
    comment: raw?.comment ?? null,
    disabled: raw?.disabled === 'true' || raw?.disabled === true,
  };
}

export function mapDhcpLease(raw: any): DhcpLeaseDto {
  return {
    id: raw?.['.id'] ?? '',
    macAddress: raw?.['mac-address'] ?? '',
    address: raw?.address ?? '',
    hostName: raw?.['host-name'] ?? null,
    status: raw?.status ?? '',
    comment: raw?.comment ?? null,
  };
}

/**
 * Helpers de débit RouterOS, centralisés ici (comme `parseRouterOsDuration`)
 * pour que `user-manager.mapper` les réutilise sans duplication.
 */

/** Token RouterOS ("2M", "512k") → bits/s. */
export function parseRateToken(token: string): number | null {
  const match = token.trim().match(/^([\d.]+)([kKmMgG]?)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : unit === 'g' ? 1_000_000_000 : 1;
  return Math.round(value * multiplier);
}

/** bits/s → token RouterOS ("6M", "512k"). */
export function formatRateToken(bitsPerSecond?: number): string | undefined {
  if (bitsPerSecond == null) return undefined;
  if (bitsPerSecond >= 1_000_000) return `${bitsPerSecond / 1_000_000}M`;
  if (bitsPerSecond >= 1_000) return `${bitsPerSecond / 1_000}k`;
  return `${bitsPerSecond}`;
}

/** bits/s applicatifs → token RouterOS "rx/tx" ("6M/4M"). */
export function buildRateLimitToken(rx?: number, tx?: number): string | undefined {
  if (rx === undefined && tx === undefined) return undefined;
  return `${formatRateToken(rx) ?? 'unlimited'}/${formatRateToken(tx) ?? 'unlimited'}`;
}

/** Token RouterOS "rx/tx" ("6M/4M") → bits/s séparés. */
export function splitRateLimitToken(value: unknown): {
  rx: number | null;
  tx: number | null;
} {
  const [rxToken, txToken] = String(value ?? '').split('/');
  return {
    rx: rxToken ? parseRateToken(rxToken) : null,
    tx: txToken ? parseRateToken(txToken) : null,
  };
}

export function mapHotspotProfile(raw: any): HotspotProfileDto {
  const rateLimit = splitRateLimitToken(raw?.['rate-limit']);

  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    rateLimitRxBitsPerSecond: rateLimit.rx,
    rateLimitTxBitsPerSecond: rateLimit.tx,
    sessionTimeoutSeconds: raw?.['session-timeout'] != null ? parseRouterOsDuration(raw['session-timeout']) : null,
    // "unlimited" sur les profils Admin : non numérique, ramené à 1 appareil.
    sharedUsers: Number(raw?.['shared-users']) || 1,
    idleTimeoutSeconds: raw?.['idle-timeout'] != null ? parseRouterOsDuration(raw['idle-timeout']) : null,
    keepaliveTimeoutSeconds:
      raw?.['keepalive-timeout'] != null ? parseRouterOsDuration(raw['keepalive-timeout']) : null,
    // RouterOS rend la chaîne "true"/"false", pas un booléen.
    addMacCookie: raw?.['add-mac-cookie'] === 'true' || raw?.['add-mac-cookie'] === true,
    macCookieTimeoutSeconds:
      raw?.['mac-cookie-timeout'] != null ? parseRouterOsDuration(raw['mac-cookie-timeout']) : null,
  };
}

const DURATION_UNITS: Record<string, number> = {
  w: 604800,
  d: 86400,
  h: 3600,
  m: 60,
  s: 1,
};

/**
 * RouterOS exprime les durées de deux façons, toutes deux rencontrées sur un
 * hAP ac² en v7.24 :
 *  - compacte, la plus courante via l'API REST : "4w1d23h57m32s", "1h32m42s",
 *    "2m28s", "45s" ;
 *  - héritée, avec un temps en notation horloge : "1d02:03:04", "00:05:00".
 *
 * Centralisé ici pour ne jamais être dupliqué ailleurs dans la couche MikroTik.
 */
export function parseRouterOsDuration(value: unknown): number {
  if (value == null) return 0;
  const str = String(value).trim();
  if (!str) return 0;

  // Forme héritée : la partie horloge est séparée par des deux-points.
  if (str.includes(':')) {
    const dayMatch = str.match(/^(\d+)d/);
    const days = dayMatch ? Number(dayMatch[1]) : 0;
    const timePart = dayMatch ? str.slice(dayMatch[0].length) : str;
    const [h = '0', m = '0', s = '0'] = timePart.split(':');
    return days * 86400 + (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
  }

  // Forme compacte : une suite de paires nombre+unité.
  const parts = str.matchAll(/(\d+(?:\.\d+)?)([wdhms])/g);
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of parts) {
    total += Number(amount) * DURATION_UNITS[unit];
    matched = true;
  }

  // Valeur nue ("3600") : RouterOS la donne déjà en secondes.
  return matched ? Math.round(total) : Number(str) || 0;
}

export function mapWalledGardenEntry(raw: any): WalledGardenEntryDto {
  return {
    id: raw?.['.id'] ?? '',
    action: raw?.action === 'deny' ? 'deny' : 'allow',
    dstHost: raw?.['dst-host'] ?? null,
    dstPort: raw?.['dst-port'] ?? null,
    path: raw?.path ?? null,
    comment: raw?.comment ?? null,
    disabled: raw?.disabled === 'true' || raw?.disabled === true,
    hits: Number(raw?.hits ?? 0),
  };
}

export function mapWalledGardenIpEntry(raw: any): WalledGardenIpEntryDto {
  const action = raw?.action;
  return {
    id: raw?.['.id'] ?? '',
    action: action === 'drop' || action === 'reject' ? action : 'accept',
    dstAddress: raw?.['dst-address'] ?? null,
    dstPort: raw?.['dst-port'] ?? null,
    protocol: raw?.protocol ?? null,
    comment: raw?.comment ?? null,
    disabled: raw?.disabled === 'true' || raw?.disabled === true,
  };
}

export function mapHotspotServer(raw: any): HotspotServerDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    interfaceName: raw?.interface ?? null,
    addressPool: raw?.['address-pool'] ?? null,
    profileName: raw?.profile ?? null,
    idleTimeoutSeconds:
      raw?.['idle-timeout'] && raw['idle-timeout'] !== 'none'
        ? parseRouterOsDuration(raw['idle-timeout'])
        : null,
    addressesPerMac:
      raw?.['addresses-per-mac'] != null && raw['addresses-per-mac'] !== 'unlimited'
        ? Number(raw['addresses-per-mac'])
        : null,
    disabled: raw?.disabled === 'true' || raw?.disabled === true,
  };
}

export function mapHotspotServerProfile(raw: any): HotspotServerProfileDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    dnsName: raw?.['dns-name'] || null,
    hotspotAddress: raw?.['hotspot-address'] || null,
    htmlDirectory: raw?.['html-directory'] ?? null,
    loginBy: typeof raw?.['login-by'] === 'string' ? raw['login-by'].split(',') : [],
    httpCookieLifetimeSeconds: raw?.['http-cookie-lifetime']
      ? parseRouterOsDuration(raw['http-cookie-lifetime'])
      : null,
    useRadius: raw?.['use-radius'] === 'true' || raw?.['use-radius'] === true,
    radiusAccounting: raw?.['radius-accounting'] === 'true' || raw?.['radius-accounting'] === true,
  };
}
