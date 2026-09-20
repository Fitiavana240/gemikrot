/**
 * Les tables de diagnostic et de débit que WinBox expose sous `IP`, `Queues`,
 * `Interfaces` et `Log`.
 *
 * **Lecture seule, par décision.** Les modifier suppose de comprendre ce qu'on
 * casse sur un routeur qui sert des centaines de clients ; la console montre,
 * WinBox modifie.
 *
 * Formes relevées sur un hAP ac² en RouterOS 7.24.4 le 2026-09-20, figées
 * dans `tests/mappers/router-tools.spec.ts`.
 */

/** Une paire montant/descendant, telle que RouterOS les écrit : `"6000000/4000000"`. */
export interface PaireDto {
  /** Ce que le client **envoie**. */
  montant: number;
  /** Ce que le client **reçoit**. C'est le chiffre qu'il perçoit comme « le débit ». */
  descendant: number;
}

/** Une file simple — `/queue/simple`. C'est elle qui tient le débit d'un client. */
export interface SimpleQueueDto {
  id: string;
  name: string;
  /** Adresse ou plage à laquelle la file s'applique. */
  target: string;
  /** Plafond, en bits par seconde. */
  maxLimit: PaireDto;
  /** Débit garanti, en bits par seconde. Zéro quand rien n'est garanti. */
  limitAt: PaireDto;
  /** Débit instantané, en bits par seconde. */
  rate: PaireDto;
  bytes: PaireDto;
  dropped: PaireDto;
  /**
   * Vrai quand le HotSpot l'a créée lui-même à l'ouverture d'une session.
   * Ces files-là portent un nom entre chevrons et disparaissent à la
   * déconnexion : les modifier n'a pas de sens, elles se refont.
   */
  dynamic: boolean;
  disabled: boolean;
  comment: string | null;
}

/** Une ligne du journal du routeur — `/log`. */
export interface RouterLogEntryDto {
  id: string;
  /** Tel que le routeur l'écrit, dans **son** fuseau. */
  time: string;
  /** `hotspot`, `wireguard`, `error`… plusieurs par ligne. */
  topics: string[];
  message: string;
  /** Vrai si l'un des sujets marque une erreur ou un avertissement. */
  isProblem: boolean;
}

/** Une interface réseau — `/interface`. */
export interface NetworkInterfaceStatsDto {
  id: string;
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  macAddress: string | null;
  mtu: number | null;
  rxBytes: number;
  txBytes: number;
  rxErrors: number;
  txErrors: number;
  rxDrops: number;
  txDrops: number;
  /**
   * Nombre de coupures du lien depuis le démarrage. Un compteur qui grimpe
   * sur le lien montant explique des plaintes que rien d'autre n'explique.
   */
  linkDowns: number;
  lastLinkUpTime: string | null;
  lastLinkDownTime: string | null;
}

/** Un service d'administration — `/ip/service`. */
export interface IpServiceDto {
  id: string;
  name: string;
  port: number | null;
  protocol: string | null;
  /**
   * Adresses autorisées à joindre ce service. Vide signifie **toutes**, ce
   * qui n'est pas la même chose qu'aucune — et c'est la confusion qui a
   * coupé l'accès à ce projet une fois.
   */
  availableFrom: string[];
  disabled: boolean;
  certificate: string | null;
  maxSessions: number | null;
}

/** L'état du service DDNS de MikroTik — `/ip/cloud`. */
export interface IpCloudDto {
  /** `auto`, `yes`, `no`… le routeur ne rend pas un booléen. */
  ddnsEnabled: string;
  /** Nul tant qu'aucun nom n'a été attribué — c'est le cas quand DDNS est coupé. */
  dnsName: string | null;
  publicAddress: string | null;
  updateTime: boolean;
  backToHomeVpn: string | null;
}

/** Une entrée ARP — `/ip/arp`. La correspondance adresse ↔ matériel. */
export interface ArpEntryDto {
  id: string;
  address: string;
  macAddress: string | null;
  interfaceName: string;
  /** Vrai quand l'entrée vient du trafic, faux quand elle a été posée à la main. */
  dynamic: boolean;
  /** Vrai quand l'adresse matérielle est connue. */
  complete: boolean;
  /** Issue d'un bail DHCP. */
  fromDhcp: boolean;
  status: string | null;
  disabled: boolean;
}

/** Un serveur DHCP — `/ip/dhcp-server`. */
export interface DhcpServerDto {
  id: string;
  name: string;
  interfaceName: string;
  addressPool: string | null;
  leaseTime: string | null;
  useRadius: boolean;
  disabled: boolean;
  invalid: boolean;
}
