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
  /**
   * Temps deja consomme par ce compte, cumule sur toutes ses sessions.
   * C'est la colonne « Uptime » de WinBox — a ne pas confondre avec
   * `limitUptimeSeconds`, qui est le plafond et non la consommation.
   */
  uptimeSeconds: number;
  /** Absent du routeur tant qu'aucun plafond n'est pose : `null`, pas zero. */
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

/**
 * Cookie HotSpot (`/ip/hotspot/cookie`). Un client dont le cookie est encore
 * valide se reconnecte **sans repasser par RADIUS**, donc sans que User
 * Manager ne soit consulté : suspendre un compte ne suffit pas à le couper
 * tant que son cookie vit (jusqu'à 3 jours sur ce parc).
 */
export interface HotspotCookieDto {
  id: string;
  username: string;
  macAddress: string;
  expiresInSeconds: number;
}

/**
 * Entrée du Walled Garden par nom de domaine
 * (`/ip/hotspot/walled-garden`) : ce qu'un client peut joindre **avant** de
 * s'authentifier. Sans entrée, la page de paiement est inatteignable pour
 * qui n'a pas encore de code.
 */
export interface WalledGardenEntryDto {
  id: string;
  /** `allow` laisse passer, `deny` bloque explicitement. */
  action: 'allow' | 'deny';
  dstHost: string | null;
  dstPort: string | null;
  path: string | null;
  comment: string | null;
  disabled: boolean;
  /** Nombre de fois que la règle a servi — dit si elle est utile. */
  hits: number;
}

/**
 * Entrée du Walled Garden par adresse (`/ip/hotspot/walled-garden/ip`).
 * Le vocabulaire diffère de la liste par domaine : l'action y est `accept`
 * et non `allow`.
 */
export interface WalledGardenIpEntryDto {
  id: string;
  action: 'accept' | 'drop' | 'reject';
  dstAddress: string | null;
  dstPort: string | null;
  protocol: string | null;
  comment: string | null;
  disabled: boolean;
}

/** Serveur HotSpot (`/ip/hotspot`). */
export interface HotspotServerDto {
  id: string;
  name: string;
  interfaceName: string | null;
  addressPool: string | null;
  profileName: string | null;
  idleTimeoutSeconds: number | null;
  addressesPerMac: number | null;
  disabled: boolean;
}

/**
 * Profil de serveur (`/ip/hotspot/profile`). `loginBy` et
 * `httpCookieLifetimeSeconds` expliquent qu'un client puisse se reconnecter
 * sans repasser par RADIUS : c'est là que se joue la portée réelle d'une
 * suspension.
 */
export interface HotspotServerProfileDto {
  id: string;
  name: string;
  dnsName: string | null;
  hotspotAddress: string | null;
  htmlDirectory: string | null;
  loginBy: string[];
  httpCookieLifetimeSeconds: number | null;
  useRadius: boolean;
  radiusAccounting: boolean;
}
