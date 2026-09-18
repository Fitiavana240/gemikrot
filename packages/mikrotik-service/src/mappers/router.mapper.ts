import {
  ClockDto,
  NetworkInterfaceDto,
  NtpStatusDto,
  RadiusStatusDto,
  RouterIdentityDto,
  SystemResourceDto,
} from '../dto/router.dto';

/**
 * Les réponses REST RouterOS utilisent des clés kebab-case et des valeurs
 * quasi systématiquement sérialisées en string. Ces mappers sont le SEUL
 * endroit du code autorisé à connaître cette forme brute ; toute la
 * logique métier au-dessus manipule exclusivement des DTOs propres.
 */

export function mapRouterIdentity(raw: any): RouterIdentityDto {
  return { name: raw?.name ?? '' };
}

export function mapSystemResource(raw: any): SystemResourceDto {
  return {
    uptime: raw?.uptime ?? '',
    version: raw?.version ?? '',
    buildTime: raw?.['build-time'] ?? '',
    cpuLoadPercent: Number(raw?.['cpu-load'] ?? 0),
    freeMemoryBytes: Number(raw?.['free-memory'] ?? 0),
    totalMemoryBytes: Number(raw?.['total-memory'] ?? 0),
    cpuCount: Number(raw?.['cpu-count'] ?? 1),
    cpuFrequencyMHz: Number(raw?.['cpu-frequency'] ?? 0),
    freeHddSpaceBytes: Number(raw?.['free-hdd-space'] ?? 0),
    totalHddSpaceBytes: Number(raw?.['total-hdd-space'] ?? 0),
    architectureName: raw?.['architecture-name'] ?? '',
    boardName: raw?.['board-name'] ?? '',
    platform: raw?.platform ?? '',
  };
}

export function mapNetworkInterface(raw: any): NetworkInterfaceDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    type: raw?.type ?? '',
    running: raw?.running === 'true' || raw?.running === true,
    disabled: raw?.disabled === 'true' || raw?.disabled === true,
    mtu: raw?.mtu != null ? Number(raw.mtu) : null,
    macAddress: raw?.['mac-address'] ?? null,
    rxBytes: Number(raw?.['rx-byte'] ?? 0),
    txBytes: Number(raw?.['tx-byte'] ?? 0),
    rxPackets: Number(raw?.['rx-packet'] ?? 0),
    txPackets: Number(raw?.['tx-packet'] ?? 0),
    comment: raw?.comment ?? null,
  };
}

export function mapClock(raw: any): ClockDto {
  return {
    time: raw?.time ?? '',
    date: raw?.date ?? '',
    timeZone: raw?.['time-zone-name'] ?? '',
    gmtOffset: raw?.['gmt-offset'] ?? '',
  };
}

export function mapNtpStatus(raw: any): NtpStatusDto {
  const rawServers: string = raw?.servers ?? raw?.['primary-ntp'] ?? '';
  const servers = String(rawServers)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    enabled: raw?.enabled === 'true' || raw?.enabled === true,
    status: raw?.status ?? 'unknown',
    servers,
    lastUpdate: raw?.['last-update'] ?? null,
  };
}

export function mapRadiusStatus(systemRaw: any, userManagerReachable: boolean): RadiusStatusDto {
  return {
    userManagerRunning: userManagerReachable,
    radiusIncomingEnabled: systemRaw?.['radius-incoming'] === 'true' || systemRaw?.['radius-incoming'] === true,
    activeSessionsCount: Number(systemRaw?.activeSessionsCount ?? 0),
    details: systemRaw ?? {},
  };
}
