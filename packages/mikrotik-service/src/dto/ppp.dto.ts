/**
 * PPPoE : l'autre façon de vendre l'accès.
 *
 * Là où le HotSpot intercepte un navigateur et demande un code, le PPPoE
 * demande au routeur du client d'ouvrir une session authentifiée. C'est ce
 * qu'utilisent les fournisseurs de quartier pour les abonnés à domicile — et
 * cela ne dépend pas de la façon dont le routeur reçoit Internet : derrière
 * Starlink, qui ne parle pas PPPoE en amont, servir du PPPoE en aval marche
 * exactement pareil.
 *
 * Toutes les formes de ce fichier sont relevées sur un hAP ac² en RouterOS
 * 7.24.4, figées dans `ppp.mapper.spec.ts`.
 */

/** Un compte PPPoE — `/ppp/secret`. */
export interface PppSecretDto {
  id: string;
  username: string;
  disabled: boolean;
  /** Nom du profil appliqué : c'est lui qui porte le débit, pas le compte. */
  profile: string | null;
  /** `pppoe`, `any`, `pptp`… `any` accepte tous les services. */
  service: string;
  comment: string | null;
  /** Adresse imposée à ce compte, si elle ne vient pas du bassin du profil. */
  remoteAddress: string | null;
  /** Quotas de volume. Zéro signifie « pas de quota » côté RouterOS. */
  limitBytesIn: number | null;
  limitBytesOut: number | null;
  /**
   * Dernière déconnexion. `null` quand le compte ne s'est jamais connecté :
   * RouterOS l'écrit alors `1970-01-01 00:00:00`, et non une valeur vide —
   * la prendre pour une date réelle ferait passer tout compte neuf pour un
   * abonné parti en 1970.
   */
  lastLoggedOut: string | null;
}

/** Un profil PPPoE — `/ppp/profile`. Il porte le débit et l'adressage. */
export interface PppProfileDto {
  id: string;
  name: string;
  comment: string | null;
  /** Vrai pour les profils livrés avec RouterOS, qu'on ne supprime pas. */
  isDefault: boolean;
  /** Adresse que prend le routeur du côté de cette session. */
  localAddress: string | null;
  /**
   * **Nom d'un bassin d'adresses**, pas une adresse : le champ accepte les
   * deux, et c'est un bassin qui sert dès qu'il y a plus d'un abonné.
   */
  remoteAddress: string | null;
  dnsServer: string | null;
  /**
   * Débit, en bits par seconde. RouterOS l'expose ici en **un seul jeton**
   * `"2M/2M"` — contrairement aux limitations User Manager, qui utilisent
   * deux champs séparés. Confondre les deux conventions a déjà coûté un
   * correctif sur ce projet.
   */
  rateLimitRxBitsPerSecond: number | null;
  rateLimitTxBitsPerSecond: number | null;
  /** Une seule session simultanée par compte. */
  onlyOne: boolean | null;
}

/** Une session PPPoE en cours — `/ppp/active`. */
export interface PppActiveDto {
  id: string;
  username: string;
  service: string;
  callerId: string | null;
  address: string | null;
  uptimeSeconds: number;
  /** Non renseigné tant que la session n'a pas consommé. */
  bytesIn: number | null;
  bytesOut: number | null;
}

/** Le serveur PPPoE posé sur une interface — `/interface/pppoe-server/server`. */
export interface PppoeServerDto {
  id: string;
  serviceName: string;
  interfaceName: string;
  disabled: boolean;
  defaultProfile: string | null;
  /** Méthodes acceptées, ex. `pap,chap,mschap1,mschap2`. */
  authentication: string[];
  oneSessionPerHost: boolean;
  /** `null` quand RouterOS répond `unlimited`, qui n'est pas un nombre. */
  maxSessions: number | null;
}

/** Un bassin d'adresses — `/ip/pool`. Ce que consomme `remoteAddress`. */
export interface IpPoolDto {
  id: string;
  name: string;
  ranges: string;
  total: number | null;
  used: number | null;
  available: number | null;
}
