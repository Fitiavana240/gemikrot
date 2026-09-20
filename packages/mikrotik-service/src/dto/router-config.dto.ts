/**
 * Tables de configuration que WinBox montre et que la console ignorait.
 *
 * Toutes les formes de ce fichier sont relevées sur un hAP ac² en RouterOS
 * 7.24.4, le 2026-09-20, et figées dans `tests/mappers/router-config.spec.ts`.
 */

/** Un client RADIUS déclaré dans User Manager — `/user-manager/router`. */
export interface UmRouterDto {
  id: string;
  name: string;
  address: string;
  /** `udp` le plus souvent ; RouterOS accepte aussi `radsec`. */
  protocol: string;
  coaPort: number | null;
  disabled: boolean;
  /**
   * **Le secret partagé n'est jamais rendu.** Il authentifie le routeur
   * auprès de RADIUS : le faire transiter jusqu'au navigateur reviendrait à
   * le publier. Seul le fait qu'il soit posé est exposé.
   */
  hasSharedSecret: boolean;
}

/** Un groupe d'authentification — `/user-manager/user/group`. */
export interface UmUserGroupDto {
  id: string;
  name: string;
  /** Méthodes acceptées à l'extérieur du tunnel, ex. `PAP`, `CHAP`. */
  outerAuths: string[];
  /** Méthodes acceptées à l'intérieur, pour les protocoles à tunnel. */
  innerAuths: string[];
  attributes: string | null;
  /** Vrai pour les groupes livrés avec RouterOS, qu'on ne supprime pas. */
  isDefault: boolean;
}

/** Un attribut RADIUS connu — `/user-manager/attribute`. */
export interface UmAttributeDto {
  id: string;
  name: string;
  /** Nom normalisé quand l'attribut est standard, sinon nul. */
  standardName: string | null;
  typeId: number | null;
  valueType: string | null;
  /** Nul pour un attribut standard ; renseigné pour un attribut constructeur. */
  vendorId: string | null;
  packetTypes: string[];
  isDefault: boolean;
}

/** Un port applicatif suivi par le HotSpot — `/ip/hotspot/service-port`. */
export interface HotspotServicePortDto {
  id: string;
  /** `ftp`, `sip`… le protocole dont le HotSpot suit les connexions. */
  name: string;
  ports: string;
  disabled: boolean;
}
