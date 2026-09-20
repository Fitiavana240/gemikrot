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

export interface RouterPackage {
  id: string;
  name: string;
  version: string | null;
  sizeBytes: number | null;
  disabled: boolean;
  buildTime: string | null;
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
  packageVersion: string | null;
  packageSizeBytes: number | null;
  /** `enable` quand l'activation attend un redémarrage. */
  packageScheduled: string | null;
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
  services: (routerId: string) => api.get<IpService[]>(`${base(routerId)}/services`),
  cloud: (routerId: string) => api.get<IpCloud>(`${base(routerId)}/cloud`),
  arp: (routerId: string) => api.get<ArpEntry[]>(`${base(routerId)}/arp`),
  dhcpServers: (routerId: string) => api.get<DhcpServer[]>(`${base(routerId)}/dhcp-servers`),
  firewallFilter: (routerId: string) =>
    api.get<FirewallRule[]>(`${base(routerId)}/firewall/filter`),
  firewallNat: (routerId: string) => api.get<FirewallRule[]>(`${base(routerId)}/firewall/nat`),
  dns: (routerId: string) => api.get<DnsSettings>(`${base(routerId)}/dns`),
  dnsStatic: (routerId: string) => api.get<DnsStaticEntry[]>(`${base(routerId)}/dns/static`),
  routes: (routerId: string) => api.get<Route[]>(`${base(routerId)}/routes`),
  storage: (routerId: string) => api.get<RouterStorage>(`${base(routerId)}/storage`),
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
