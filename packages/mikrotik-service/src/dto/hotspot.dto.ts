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
  server: string | null;
  bytesIn: number;
  bytesOut: number;
  limitUptimeSeconds: number | null;
  limitBytesIn: number | null;
  limitBytesOut: number | null;
}

/** Type d'une entrée `/ip/hotspot/ip-binding`. */
export type IpBindingType = 'regular' | 'bypassed' | 'blocked';

/**
 * Contournement du portail captif : un appareil incapable d'afficher la page
 * de login (TV connectée, caméra, objet connecté) est identifié par sa MAC et
 * autorisé — ou bloqué — sans passer par l'authentification HotSpot.
 */
export interface IpBindingDto {
  id: string;
  macAddress: string;
  address: string | null;
  toAddress: string | null;
  type: IpBindingType;
  server: string | null;
  comment: string | null;
  disabled: boolean;
}

/** Bail DHCP — seule source côté routeur permettant de deviner un appareil. */
export interface DhcpLeaseDto {
  id: string;
  macAddress: string;
  address: string;
  hostName: string | null;
  status: string;
  comment: string | null;
}

export interface HotspotProfileDto {
  id: string;
  name: string;
  /** Débits applicatifs en bits/s — le token RouterOS ("6M/4M") ne sort pas du module. */
  rateLimitRxBitsPerSecond: number | null;
  rateLimitTxBitsPerSecond: number | null;
  sessionTimeoutSeconds: number | null;
  /** `shared-users` RouterOS : nombre d'appareils simultanés autorisés. */
  sharedUsers: number;
  idleTimeoutSeconds: number | null;
}
