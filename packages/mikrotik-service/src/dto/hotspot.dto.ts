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
  /**
   * Quotas portés par **le compte**, indépendants du profil.
   *
   * Un profil borne une session ; ces plafonds bornent le ticket lui-même, et
   * un vendeur peut les régler compte par compte sans toucher au profil. Les
   * croire hérités du profil ferait passer un ticket spécial pour un ticket
   * ordinaire.
   */
  limitBytesIn: number | null;
  limitBytesOut: number | null;
  /** Plafond des deux sens confondus, distinct de leur somme. */
  limitBytesTotal: number | null;
  /**
   * L'appareil auquel ce compte est lie, s'il l'est.
   *
   * **C'est la seule facon d'avoir a la fois l'automatisme et l'echeance.**
   * Un contournement (`ip-binding bypassed`) fait passer l'appareil avant le
   * portail : il n'ouvre aucune session, donc rien ne le limite dans le temps
   * et rien ne l'arrete jamais. Un compte lie a une MAC, lui, ouvre une vraie
   * session -- le client ne voit pas plus de page de connexion, mais le
   * profil s'applique et l'echeance existe.
   *
   * Vide pour un ticket ordinaire, qui n'appartient a aucun appareil.
   */
  macAddress: string | null;
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
  /**
   * Délai sans réponse avant que le routeur ferme la session.
   *
   * Distinct de l'inactivité : un client peut ne rien télécharger et répondre
   * quand même. C'est ce délai-là qui coupe un appareil parti sans se
   * déconnecter, et donc qui libère sa place quand `shared-users` vaut 1.
   */
  keepaliveTimeoutSeconds: number | null;
  /**
   * Le routeur pose-t-il un cookie à la connexion ?
   *
   * **Le réglage le plus lourd de conséquences de tout ce menu.** Tant qu'il
   * est actif, un client déjà venu se reconnecte sans repasser par RADIUS :
   * sa validité n'est pas vérifiée, et bloquer son compte ne suffit pas à le
   * couper. Relevé sur ce parc : neuf sessions en cours sur dix sont entrées
   * par cookie.
   */
  addMacCookie: boolean;
  /** Durée de vie du cookie posé par ce profil. */
  macCookieTimeoutSeconds: number | null;
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
