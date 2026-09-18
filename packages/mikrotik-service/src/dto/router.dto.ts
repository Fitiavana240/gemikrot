export interface RouterIdentityDto {
  name: string;
}

export interface SystemResourceDto {
  uptime: string;
  version: string;
  buildTime: string;
  cpuLoadPercent: number;
  freeMemoryBytes: number;
  totalMemoryBytes: number;
  cpuCount: number;
  cpuFrequencyMHz: number;
  freeHddSpaceBytes: number;
  totalHddSpaceBytes: number;
  architectureName: string;
  boardName: string;
  platform: string;
}

export interface NetworkInterfaceDto {
  id: string;
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  mtu: number | null;
  macAddress: string | null;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  comment: string | null;
}

export interface ClockDto {
  time: string;
  date: string;
  timeZone: string;
  gmtOffset: string;
}

export interface NtpStatusDto {
  enabled: boolean;
  status: string;
  servers: string[];
  lastUpdate: string | null;
}

export interface RadiusStatusDto {
  userManagerRunning: boolean;
  radiusIncomingEnabled: boolean;
  activeSessionsCount: number;
  details: Record<string, unknown>;
}
