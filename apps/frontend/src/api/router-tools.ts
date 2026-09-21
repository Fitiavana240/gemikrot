import { api } from './client';

/** Paire montant/descendant, telle que RouterOS écrit presque tout. */
export interface Paire {
  /** Ce que le client envoie. */
  montant: number;
  /** Ce que le client reçoit — le chiffre qu'il perçoit comme « le débit ». */
  descendant: number;
}

export interface SimpleQueue {
  id: string;
  name: string;
  target: string;
  maxLimit: Paire;
  limitAt: Paire;
  rate: Paire;
  bytes: Paire;
  dropped: Paire;
  /** Créée par le HotSpot à l'ouverture d'une session, et refaite à la suivante. */
  dynamic: boolean;
  disabled: boolean;
  comment: string | null;
}

export interface RouterLogEntry {
  id: string;
  time: string;
  topics: string[];
  message: string;
  isProblem: boolean;
}

export interface InterfaceStats {
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
  /** Coupures du lien depuis le démarrage : le chiffre qui explique l'inexplicable. */
  linkDowns: number;
  lastLinkUpTime: string | null;
  lastLinkDownTime: string | null;
}

export interface IpService {
  id: string;
  name: string;
  port: number | null;
  protocol: string | null;
  /** Vide signifie **toutes** les adresses, pas aucune. */
  availableFrom: string[];
  disabled: boolean;
  certificate: string | null;
  maxSessions: number | null;
  /**
   * Ce que le service coûte par nature, adresse mise à part. `clair` = les
   * identifiants voyagent en clair sur le lien.
   */
  risque: 'clair' | 'debit' | 'annonce' | null;
  /** Vrai quand le routeur ouvre ce port de lui-même : portail, DHCP, NTP… */
  dynamique: boolean;
}

export interface IpCloud {
  ddnsEnabled: string;
  dnsName: string | null;
  publicAddress: string | null;
  updateTime: boolean;
  backToHomeVpn: string | null;
}

export interface ArpEntry {
  id: string;
  address: string;
  macAddress: string | null;
  interfaceName: string;
  dynamic: boolean;
  complete: boolean;
  fromDhcp: boolean;
  status: string | null;
  disabled: boolean;
}

export interface DhcpServer {
  id: string;
  name: string;
  interfaceName: string;
  addressPool: string | null;
  leaseTime: string | null;
  useRadius: boolean;
  disabled: boolean;
  invalid: boolean;
}


/**
 * Un bassin d'adresses — `/ip/pool`.
 *
 * Le plafond **réel** du nombre de clients simultanés, sans rapport avec le
 * nombre de tickets vendus. Épuisé, le DHCP ne distribue plus rien : le
 * client voit « connecté, sans Internet », le portail ne s'affiche même pas,
 * et le HotSpot se porte très bien. Rien d'autre dans la console ne le dit.
 */
export interface BassinAdresses {
  id: string;
  name: string;
  ranges: string;
  total: number | null;
  used: number | null;
  available: number | null;
  /**
   * En NAT un-pour-un, le HotSpot prend une **seconde** adresse du même
   * bassin par client : vingt appareils en consomment vingt-neuf, mesuré sur
   * ce parc. Compter les baux DHCP donne donc un chiffre trop bas.
   */
  byOwner: { owner: string; count: number }[];
}

export interface FirewallRule {
  id: string;
  /** Position dans la chaine, a partir de 0 : c'est l'ordre d'evaluation. */
  position: number;
  chain: string;
  action: string;
  protocol: string | null;
  srcAddress: string | null;
  dstAddress: string | null;
  srcPort: string | null;
  dstPort: string | null;
  inInterface: string | null;
  outInterface: string | null;
  jumpTarget: string | null;
  toPorts: string | null;
  rejectWith: string | null;
  /** Non vide quand le HotSpot l'a posee : elle se refait toute seule. */
  hotspot: string | null;
  dynamic: boolean;
  disabled: boolean;
  invalid: boolean;
  log: boolean;
  logPrefix: string | null;
  bytes: number;
  packets: number;
  comment: string | null;
}

export interface DnsSettings {
  servers: string[];
  dynamicServers: string[];
  allowRemoteRequests: boolean;
  /** En Kio. */
  cacheSize: number | null;
  cacheUsed: number | null;
  maxConcurrentQueries: number | null;
  useDohServer: string | null;
  verifyDohCert: boolean;
}

export interface DnsStaticEntry {
  id: string;
  name: string | null;
  address: string | null;
  type: string | null;
  ttlSeconds: number;
  dynamic: boolean;
  disabled: boolean;
  comment: string | null;
}

export interface Route {
  id: string;
  dstAddress: string;
  gateway: string | null;
  immediateGw: string | null;
  distance: number | null;
  routingTable: string | null;
  scope: number | null;
  targetScope: number | null;
  active: boolean;
  dynamic: boolean;
  isStatic: boolean;
  connect: boolean;
  dhcp: boolean;
  comment: string | null;
}

export interface RouterDisk {
  id: string;
  slot: string;
  type: string;
  fs: string | null;
  model: string | null;
  serial: string | null;
  sizeBytes: number | null;
  /** RouterOS 7.24 ne le donne pas : presque toujours `null`. */
  freeBytes: number | null;
  mounted: boolean;
  mountPoint: string | null;
  isPartition: boolean;
  interfaceName: string | null;
  disabled: boolean;
}

export interface RouterFile {
  id: string;
  /** Chemin complet, racine comprise : `flash/hotspot/login.html`. */
  name: string;
  /** Racine du chemin : `flash`, `usb1-part1`, `um5files`… */
  root: string;
  /** `directory`, `disk`, `backup`, `.html file`… tel que RouterOS l'écrit. */
  type: string;
  /** Absente pour un dossier. */
  sizeBytes: number | null;
  /** Heure locale du routeur, sans fuseau — non convertie. */
  lastModified: string | null;
}

export interface RouterPackage {
  id: string;
  name: string;
  version: string | null;
  sizeBytes: number | null;
  disabled: boolean;
  buildTime: string | null;
  /** Réellement installé — la version en fait foi, pas la simple présence. */
  installed: boolean;
  /** Présent dans l'image, installable sans rien téléverser. */
  available: boolean;
  /** Tel que RouterOS l'écrit : « scheduled for disable », pas « disable ». */
  scheduled: string | null;
  scheduledAction: 'enable' | 'disable' | null;
}

export interface RouterStorage {
  boardName: string | null;
  version: string | null;
  architecture: string | null;
  internalTotalBytes: number;
  internalFreeBytes: number;
  memoryTotalBytes: number;
  memoryFreeBytes: number;
  disks: RouterDisk[];
  packages: RouterPackage[];
  parRacine: { root: string; bytes: number; fileCount: number }[];
  /**
   * Le micrologiciel d'amorçage, distinct de RouterOS.
   *
   * Les deux se mettent à jour séparément : une mise à niveau du système ne
   * touche pas au RouterBOOT, qui reste à sa version jusqu'à ce qu'on lance
   * l'opération et qu'on redémarre. `null` sur une machine qui n'est pas un
   * RouterBOARD, où la question ne se pose pas.
   */
  routerboard: Routerboard | null;
}

export interface Routerboard {
  model: string | null;
  serialNumber: string | null;
  currentFirmware: string | null;
  upgradeFirmware: string | null;
  miseANiveauDisponible: boolean;
}

export type NiveauConstat = 'bloquant' | 'avertissement' | 'ok';

export interface Constat {
  code: string;
  niveau: NiveauConstat;
  titre: string;
  detail: string;
  /** La commande a coller dans le terminal, ou `null` si le geste est physique. */
  commande: string | null;
  /**
   * Le nom de la réparation que la console sait appliquer, ou `null` quand le
   * geste lui échappe : brancher une clé, téléverser un paquet, redémarrer,
   * déplacer une base de tickets déjà vendus.
   */
  reparation: string | null;
}

export interface ResultatReparation {
  /** Faux quand le routeur a accepté la demande sans rien changer. */
  appliquee: boolean;
  message: string;
  /** L'état relu après coup : l'écran se rafraîchit sans second appel. */
  etat: UserManagerReadiness;
}

export interface UserManagerReadiness {
  packageInstalled: boolean;
  packageEnabled: boolean;
  /**
   * Non installé, mais présent dans l'image du routeur.
   *
   * Change le geste à prescrire : rien à téléverser, il suffit d'activer et
   * de redémarrer. C'est l'état d'un routeur neuf.
   */
  packageAvailable: boolean;
  packageVersion: string | null;
  packageSizeBytes: number | null;
  /** Ce qui attend le prochain démarrage. */
  packageScheduled: 'enable' | 'disable' | null;
  serviceEnabled: boolean;
  useProfiles: boolean;
  database: {
    path: string;
    sizeBytes: number;
    freeBytes: number;
    surSupportAmovible: boolean;
  } | null;
  internalFreeBytes: number;
  internalTotalBytes: number;
  disks: RouterDisk[];
  constats: Constat[];
}

const base = (routerId: string) => `/routers/${routerId}/tools`;

export const routerToolsApi = {
  queues: (routerId: string) => api.get<SimpleQueue[]>(`${base(routerId)}/queues`),
  log: (routerId: string, limit = 200) =>
    api.get<RouterLogEntry[]>(`${base(routerId)}/log?limit=${limit}`),
  interfaces: (routerId: string) => api.get<InterfaceStats[]>(`${base(routerId)}/interfaces`),
  /** Radios et clients ensemble : l'un ne se lit pas sans l'autre. */
  wireless: (routerId: string) =>
    api.get<{ radios: RadioWifi[]; clients: ClientWifi[] }>(`${base(routerId)}/wireless`),
  radius: (routerId: string) => api.get<ClientRadius[]>(`${base(routerId)}/radius`),
  wireguard: (routerId: string) => api.get<EtatTunnel>(`${base(routerId)}/wireguard`),
  structure: (routerId: string) => api.get<StructureReseau>(`${base(routerId)}/structure`),
  automatisations: (routerId: string) =>
    api.get<Automatisations>(`${base(routerId)}/automatisations`),
  ethernet: (routerId: string) => api.get<PortEthernet[]>(`${base(routerId)}/ethernet`),
  certificats: (routerId: string) => api.get<Certificat[]>(`${base(routerId)}/certificates`),
  horloge: (routerId: string) => api.get<HorlogeRouteur>(`${base(routerId)}/horloge`),
  acces: (routerId: string) => api.get<AccesRouteur>(`${base(routerId)}/acces`),
  connexions: (routerId: string) =>
    api.get<SuiviConnexions>(`${base(routerId)}/connexions`),
  historique: (routerId: string) =>
    api.get<ChangementRouteur[]>(`${base(routerId)}/historique`),
  services: (routerId: string) => api.get<IpService[]>(`${base(routerId)}/services`),
  cloud: (routerId: string) => api.get<IpCloud>(`${base(routerId)}/cloud`),
  arp: (routerId: string) => api.get<ArpEntry[]>(`${base(routerId)}/arp`),
  dhcpServers: (routerId: string) => api.get<DhcpServer[]>(`${base(routerId)}/dhcp-servers`),
  pools: (routerId: string) => api.get<BassinAdresses[]>(`${base(routerId)}/pools`),
  firewallFilter: (routerId: string) =>
    api.get<FirewallRule[]>(`${base(routerId)}/firewall/filter`),
  firewallNat: (routerId: string) => api.get<FirewallRule[]>(`${base(routerId)}/firewall/nat`),
  dns: (routerId: string) => api.get<DnsSettings>(`${base(routerId)}/dns`),
  dnsStatic: (routerId: string) => api.get<DnsStaticEntry[]>(`${base(routerId)}/dns/static`),
  routes: (routerId: string) => api.get<Route[]>(`${base(routerId)}/routes`),
  storage: (routerId: string) => api.get<RouterStorage>(`${base(routerId)}/storage`),
  files: (routerId: string) => api.get<RouterFile[]>(`${base(routerId)}/files`),
  userManagerReadiness: (routerId: string) =>
    api.get<UserManagerReadiness>(`${base(routerId)}/user-manager-readiness`),
  /**
   * Applique une réparation nommée. Le code désigne une entrée d'une liste
   * blanche tenue côté serveur : aucune commande RouterOS ne transite ici.
   */
  appliquerReparation: (routerId: string, code: string) =>
    api.post<ResultatReparation>(`${base(routerId)}/repairs/${code}`, {}),
};

/** bits/s → « 6 Mb/s ». Zéro veut dire « aucun plafond », pas « zéro débit ». */
export function formatBits(bits: number): string {
  if (!bits) return 'illimité';
  if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(bits % 1_000_000 ? 1 : 0)} Mb/s`;
  if (bits >= 1_000) return `${Math.round(bits / 1_000)} kb/s`;
  return `${bits} b/s`;
}

/**
 * Une radio du routeur.
 *
 * `disabled` et `running` ne disent pas la même chose : une radio activée
 * peut ne pas émettre. Sur ce parc, les deux radios du hAP sont dans ce cas,
 * et le Wi-Fi vient de bornes branchées sur les ports Ethernet.
 */
export interface RadioWifi {
  id: string;
  name: string;
  ssid: string;
  band: string;
  channelWidth: string;
  frequency: string;
  mode: string;
  running: boolean;
  disabled: boolean;
  hideSsid: boolean;
  macAddress: string;
  securityProfile: string;
  country: string;
  txPowerDbm: number | null;
}

export interface ClientWifi {
  id: string;
  interfaceName: string;
  macAddress: string;
  /** dBm : au-delà de -70 la liaison se dégrade, au-delà de -80 elle lâche. */
  signalStrengthDbm: number | null;
  txRate: string | null;
  rxRate: string | null;
  uptimeSeconds: number | null;
}

/**
 * Le client RADIUS du routeur.
 *
 * Sans entrée active pour le service `hotspot`, aucun ticket n'est vérifié —
 * quoi que porte la base des comptes.
 */
export interface ClientRadius {
  id: string;
  services: string[];
  address: string;
  authenticationPort: number | null;
  accountingPort: number | null;
  disabled: boolean;
  timeout: string | null;
}

export interface InterfaceTunnel {
  id: string;
  name: string;
  listenPort: number | null;
  publicKey: string;
  running: boolean;
  disabled: boolean;
  comment: string | null;
}

/**
 * Un pair du tunnel, avec ce qui permet de savoir s'il vit.
 *
 * `lastHandshakeSeconds` est le seul indicateur fiable : WireGuard n'a pas
 * d'état « connecté », et une interface qui tourne ne dit rien du lien.
 *
 * Le couple émis / reçu dit **de quel côté** ça coince : du trafic émis sans
 * rien reçu est la signature d'un pair qui parle dans le vide.
 */
export interface PairTunnel {
  id: string;
  name: string | null;
  interfaceName: string;
  publicKey: string;
  endpointAddress: string | null;
  endpointPort: number | null;
  allowedAddress: string;
  lastHandshakeSeconds: number | null;
  txBytes: number;
  rxBytes: number;
  disabled: boolean;
}

export interface EtatTunnel {
  interfaces: InterfaceTunnel[];
  peers: PairTunnel[];
  /** Par quelle adresse la console a réellement joint ce routeur. */
  chemin: { adresse: string; parLeTunnel: boolean };
}

/**
 * Une adresse IP posée sur une interface.
 *
 * `dynamique` est le champ qui compte : une adresse obtenue par DHCP **peut
 * changer**, et qui la recopie ailleurs verra son réglage cesser de marcher
 * sans qu'aucune erreur ne l'explique.
 */
export interface AdresseIp {
  id: string;
  address: string;
  network: string;
  interfaceName: string;
  dynamique: boolean;
  disabled: boolean;
  invalide: boolean;
  comment: string | null;
}

export interface Pont {
  id: string;
  name: string;
  protocolMode: string;
  vlanFiltering: boolean;
  running: boolean;
  disabled: boolean;
}

/** `inactif` distingue un port branché sans lien d'un port qui travaille. */
export interface PortDuPont {
  id: string;
  interfaceName: string;
  bridgeName: string;
  inactif: boolean;
  disabled: boolean;
}

export interface BailMontant {
  id: string;
  interfaceName: string;
  status: string;
  address: string | null;
  gateway: string | null;
  disabled: boolean;
}

export interface StructureReseau {
  addresses: AdresseIp[];
  bridges: Pont[];
  ports: PortDuPont[];
  dhcpClients: BailMontant[];
}

/**
 * Un script du routeur. `policy` porte ses autorisations **propres** : elles
 * ne dépendent pas de qui le déclenche, sauf si `dontRequirePermissions`.
 */
export interface ScriptDuRouteur {
  id: string;
  name: string;
  owner: string;
  policy: string[];
  runCount: number;
  source: string;
  dontRequirePermissions: boolean;
  invalide: boolean;
}

/** Une entrée de l'ordonnanceur. `intervalSeconds` nul = exécution unique. */
export interface TachePlanifiee {
  id: string;
  name: string;
  onEvent: string;
  intervalSeconds: number | null;
  startDate: string | null;
  startTime: string | null;
  nextRun: string | null;
  runCount: number;
  owner: string;
  policy: string[];
  disabled: boolean;
}

export interface Automatisations {
  scripts: ScriptDuRouteur[];
  taches: TachePlanifiee[];
}

/**
 * Un port cuivre. `fullDuplex` a trois états : `null` sans lien, `true` sain,
 * et `false` qui est une **anomalie** et non un réglage.
 */
export interface PortEthernet {
  id: string;
  name: string;
  status: string;
  running: boolean;
  disabled: boolean;
  rate: string | null;
  fullDuplex: boolean | null;
  autoNegotiation: boolean;
  advertise: string[];
  partnerAdvertise: string[];
  collisions: number;
  fragments: number;
  fcsErrors: number;
  rxBytes: number;
  txBytes: number;
  comment: string | null;
}

export interface Certificat {
  id: string;
  name: string;
  commonName: string;
  subjectAltNames: string[];
  selfSigned: boolean;
  hasPrivateKey: boolean;
  fingerprint: string;
  keyType: string;
  keySizeBits: number | null;
  invalidBefore: string | null;
  invalidAfter: string | null;
  expiresInSeconds: number | null;
}

/**
 * L'heure du routeur. Toutes les échéances de forfaits sont calculées contre
 * elle — c'est `gmtOffset`, lu sur le routeur, qui sert aux conversions.
 */
export interface HorlogeRouteur {
  date: string;
  time: string;
  timeZone: string;
  gmtOffset: string;
  dstActive: boolean;
  ntpEnabled: boolean;
  ntpStatus: string;
  ntpServers: string[];
  ntpSyncedServer: string | null;
  ntpStratum: number | null;
  ntpOffsetMs: number | null;
  uptime: string;
}

/**
 * Un compte d'administration du routeur. `address` nul veut dire « depuis
 * n'importe où » — à ne pas confondre avec un compte HotSpot, qui n'ouvre
 * que l'accès à Internet.
 */
export interface CompteRouteur {
  id: string;
  name: string;
  group: string;
  address: string | null;
  disabled: boolean;
  lastLoggedIn: string | null;
  comment: string | null;
}

export interface GroupeRouteur {
  id: string;
  name: string;
  policy: string[];
  /** Peut se donner n'importe quel droit : `policy`. Le seul qui compte vraiment. */
  controleTotal: boolean;
  /** Peut modifier la configuration : `write`. Normal pour un compte de service. */
  ecriture: boolean;
  /** Peut lire ou emporter des secrets : mots de passe, capture, fichiers. */
  secrets: boolean;
}

/** Les portes d'entrée autres que l'API. */
export interface ExpositionRouteur {
  macServerInterfaces: string;
  macPingEnabled: boolean;
  proxyEnabled: boolean;
  upnpEnabled: boolean;
  snmpEnabled: boolean;
}

export interface AccesRouteur {
  comptes: CompteRouteur[];
  groupes: GroupeRouteur[];
  exposition: ExpositionRouteur;
}

/**
 * Ce qu'un appareil tient ouvert. `connexions` ne mesure PAS le débit : un
 * appareil peut consommer peu et tenir des centaines de connexions.
 */
export interface ClientConnexions {
  address: string;
  connexions: number;
  hostname: string | null;
  macAddress: string | null;
  /** Compte de la session ouverte. Lu dans `/active`, pas dans `/host`. */
  username: string | null;
  /** Le routeur tient-il cet appareil pour authentifié ? `null` s'il l'ignore. */
  autorise: boolean | null;
  bytesOut: number | null;
  bytesIn: number | null;
}

export interface SuiviConnexions {
  total: number;
  /** Plafond du routeur : atteint, plus aucune connexion ne passe. */
  maxEntries: number;
  tcpEstablishedTimeout: string;
  clients: ClientConnexions[];
}

/**
 * Un changement de configuration vu par le routeur, quelle qu'en soit
 * l'origine — console, WinBox ou terminal. Cent lignes au plus : une rafale
 * efface ce qui la précède.
 */
export interface ChangementRouteur {
  id: string;
  action: string;
  par: string;
  time: string;
  commande: string | null;
  /** Le routeur dit pouvoir défaire — mais voir `commandeAnnulation`. */
  annulable: boolean;
  /** Nul quand rien n'est noté pour restaurer la valeur d'avant. */
  commandeAnnulation: string | null;
  origine: string | null;
}
