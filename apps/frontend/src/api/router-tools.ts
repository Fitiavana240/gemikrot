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
};

/** bits/s → « 6 Mb/s ». Zéro veut dire « aucun plafond », pas « zéro débit ». */
export function formatBits(bits: number): string {
  if (!bits) return 'illimité';
  if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(bits % 1_000_000 ? 1 : 0)} Mb/s`;
  if (bits >= 1_000) return `${Math.round(bits / 1_000)} kb/s`;
  return `${bits} b/s`;
}
