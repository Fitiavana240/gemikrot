export interface HotspotActiveUserDto {
  id: string;
  username: string;
  address: string;
  macAddress: string;
  uptimeSeconds: number;
  sessionTimeLeftSeconds: number | null;
  idleTimeSeconds: number;
  bytesIn: number;
  bytesOut: number;
  loginBy: string;
}

export interface HotspotHostDto {
  id: string;
  macAddress: string;
  address: string;
  toAddress: string | null;
  server: string;
  idleTimeSeconds: number;
  bypassed: boolean;
  authorized: boolean;
}

export interface HotspotUserDto {
  id: string;
  username: string;
  profile: string;
  disabled: boolean;
  comment: string | null;
  limitUptimeSeconds: number | null;
  limitBytesIn: number | null;
  limitBytesOut: number | null;
}

export interface HotspotProfileDto {
  id: string;
  name: string;
  rateLimit: string | null;
  sessionTimeoutSeconds: number | null;
  sharedUsers: number;
  idleTimeoutSeconds: number | null;
}
