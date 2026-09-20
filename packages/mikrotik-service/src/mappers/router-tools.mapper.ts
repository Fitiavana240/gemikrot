import { parseRouterOsDuration } from './hotspot.mapper';
import {
  ArpEntryDto,
  DhcpServerDto,
  DnsSettingsDto,
  DnsStaticEntryDto,
  FirewallRuleDto,
  IpCloudDto,
  IpServiceDto,
  NetworkInterfaceStatsDto,
  PaireDto,
  RouteDto,
  RouterLogEntryDto,
  SimpleQueueDto,
  WirelessInterfaceDto,
  WirelessClientDto,
  RadiusClientDto,
  WireguardInterfaceDto,
  WireguardPeerDto,
  IpAddressDto,
  BridgeDto,
  BridgePortDto,
  DhcpClientDto,
} from '../dto/router-tools.dto';

/** RouterOS rend ses booléens en chaînes. */
function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

function orNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
  return text === '' ? null : text;
}

function nombreOuNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Découpe une paire `"6000000/4000000"`.
 *
 * RouterOS écrit presque tout ainsi dans les files : plafond, débit, octets,
 * paquets perdus. Le premier terme est ce que la cible **envoie**, le second
 * ce qu'elle **reçoit** — l'inverse de ce qu'on lit spontanément, et une
 * inversion ici afficherait un débit descendant à la place du montant.
 */
export function splitPaire(value: unknown): PaireDto {
  const [a = '0', b = '0'] = String(value ?? '')
    .split('/')
    .map((part) => part.trim());
  return { montant: Number(a) || 0, descendant: Number(b) || 0 };
}

/** Les sujets qui méritent l'attention dans le journal. */
const SUJETS_PROBLEME = new Set(['error', 'critical', 'warning']);

export function mapSimpleQueue(raw: any): SimpleQueueDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    target: raw?.target ?? '',
    maxLimit: splitPaire(raw?.['max-limit']),
    limitAt: splitPaire(raw?.['limit-at']),
    rate: splitPaire(raw?.rate),
    bytes: splitPaire(raw?.bytes),
    dropped: splitPaire(raw?.dropped),
    // Le HotSpot crée ses propres files à l'ouverture d'une session : elles
    // portent un nom entre chevrons et disparaissent à la déconnexion.
    dynamic: flag(raw?.dynamic),
    disabled: flag(raw?.disabled),
    comment: orNull(raw?.comment),
  };
}

export function mapRouterLogEntry(raw: any): RouterLogEntryDto {
  const topics = String(raw?.topics ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const extra = orNull(raw?.['extra-info']);
  return {
    id: raw?.['.id'] ?? '',
    time: raw?.time ?? '',
    topics,
    // `extra-info` complète parfois le message : le perdre revient à tronquer
    // la seule explication d'un incident.
    message: extra ? `${raw?.message ?? ''} — ${extra}` : (raw?.message ?? ''),
    isProblem: topics.some((t) => SUJETS_PROBLEME.has(t)),
  };
}

export function mapNetworkInterfaceStats(raw: any): NetworkInterfaceStatsDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    type: raw?.type ?? '',
    running: flag(raw?.running),
    disabled: flag(raw?.disabled),
    macAddress: orNull(raw?.['mac-address']),
    mtu: nombreOuNull(raw?.mtu),
    rxBytes: Number(raw?.['rx-byte'] ?? 0),
    txBytes: Number(raw?.['tx-byte'] ?? 0),
    rxErrors: Number(raw?.['rx-error'] ?? 0),
    txErrors: Number(raw?.['tx-error'] ?? 0),
    rxDrops: Number(raw?.['rx-drop'] ?? 0),
    txDrops: Number(raw?.['tx-drop'] ?? 0),
    // Un compteur qui grimpe sur le lien montant explique des plaintes que
    // rien d'autre n'explique.
    linkDowns: Number(raw?.['link-downs'] ?? 0),
    lastLinkUpTime: orNull(raw?.['last-link-up-time']),
    lastLinkDownTime: orNull(raw?.['last-link-down-time']),
  };
}

export function mapIpService(raw: any): IpServiceDto {
  const depuis = orNull(raw?.['available-from']);
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    port: nombreOuNull(raw?.port),
    protocol: orNull(raw?.proto),
    // Vide veut dire **toutes les adresses**, pas aucune. Confondre les deux
    // a déjà coupé l'accès à ce projet une fois.
    availableFrom: depuis ? depuis.split(',').map((a) => a.trim()).filter(Boolean) : [],
    disabled: flag(raw?.disabled),
    certificate: orNull(raw?.certificate),
    maxSessions: nombreOuNull(raw?.['max-sessions']),
  };
}

export function mapIpCloud(raw: any): IpCloudDto {
  return {
    // Le routeur rend `auto`, `yes` ou `no` : pas un booléen.
    ddnsEnabled: orNull(raw?.['ddns-enabled']) ?? 'no',
    // Absent tant qu'aucun nom n'a été attribué, ce qui est le cas quand le
    // service est coupé. `null` et non chaîne vide : l'écran doit pouvoir
    // dire « aucun nom » plutôt qu'afficher un blanc.
    dnsName: orNull(raw?.['dns-name']),
    publicAddress: orNull(raw?.['public-address']),
    updateTime: flag(raw?.['update-time']),
    backToHomeVpn: orNull(raw?.['back-to-home-vpn']),
  };
}

export function mapArpEntry(raw: any): ArpEntryDto {
  return {
    id: raw?.['.id'] ?? '',
    address: raw?.address ?? '',
    macAddress: orNull(raw?.['mac-address']),
    interfaceName: raw?.interface ?? '',
    dynamic: flag(raw?.dynamic),
    complete: flag(raw?.complete),
    fromDhcp: flag(raw?.dhcp),
    status: orNull(raw?.status),
    disabled: flag(raw?.disabled),
  };
}

export function mapDhcpServer(raw: any): DhcpServerDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    interfaceName: raw?.interface ?? '',
    addressPool: orNull(raw?.['address-pool']),
    leaseTime: orNull(raw?.['lease-time']),
    useRadius: flag(raw?.['use-radius']),
    disabled: flag(raw?.disabled),
    invalid: flag(raw?.invalid),
  };
}

/** Une liste RouterOS : `"8.8.8.8,1.1.1.1"`, ou vide. */
function listeSeparee(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * `position` n'est pas renvoyée par RouterOS : elle vient de l'ordre de
 * lecture. C'est pourtant l'information la plus importante d'une règle —
 * la première qui correspond décide, une même règle placée avant ou après
 * fait l'inverse.
 */
export function mapFirewallRule(raw: any, position: number): FirewallRuleDto {
  return {
    id: raw?.['.id'] ?? '',
    position,
    chain: raw?.chain ?? '',
    action: raw?.action ?? '',
    protocol: orNull(raw?.protocol),
    srcAddress: orNull(raw?.['src-address']),
    dstAddress: orNull(raw?.['dst-address']),
    srcPort: orNull(raw?.['src-port']),
    dstPort: orNull(raw?.['dst-port']),
    inInterface: orNull(raw?.['in-interface']),
    outInterface: orNull(raw?.['out-interface']),
    jumpTarget: orNull(raw?.['jump-target']),
    toPorts: orNull(raw?.['to-ports']),
    rejectWith: orNull(raw?.['reject-with']),
    hotspot: orNull(raw?.hotspot),
    dynamic: flag(raw?.dynamic),
    disabled: flag(raw?.disabled),
    invalid: flag(raw?.invalid),
    log: flag(raw?.log),
    logPrefix: orNull(raw?.['log-prefix']),
    bytes: Number(raw?.bytes) || 0,
    packets: Number(raw?.packets) || 0,
    comment: orNull(raw?.comment),
  };
}

export function mapDnsSettings(raw: any): DnsSettingsDto {
  return {
    servers: listeSeparee(raw?.servers),
    dynamicServers: listeSeparee(raw?.['dynamic-servers']),
    allowRemoteRequests: flag(raw?.['allow-remote-requests']),
    cacheSize: nombreOuNull(raw?.['cache-size']),
    cacheUsed: nombreOuNull(raw?.['cache-used']),
    maxConcurrentQueries: nombreOuNull(raw?.['max-concurrent-queries']),
    useDohServer: orNull(raw?.['use-doh-server']),
    verifyDohCert: flag(raw?.['verify-doh-cert']),
  };
}

export function mapDnsStaticEntry(raw: any): DnsStaticEntryDto {
  return {
    id: raw?.['.id'] ?? '',
    name: orNull(raw?.name),
    address: orNull(raw?.address),
    type: orNull(raw?.type),
    // `"1d"`, `"5m"` : une durée, pas un nombre de secondes.
    ttlSeconds: parseRouterOsDuration(raw?.ttl),
    dynamic: flag(raw?.dynamic),
    disabled: flag(raw?.disabled),
    comment: orNull(raw?.comment),
  };
}

export function mapRoute(raw: any): RouteDto {
  return {
    id: raw?.['.id'] ?? '',
    dstAddress: raw?.['dst-address'] ?? '',
    gateway: orNull(raw?.gateway),
    immediateGw: orNull(raw?.['immediate-gw']),
    distance: nombreOuNull(raw?.distance),
    routingTable: orNull(raw?.['routing-table']),
    scope: nombreOuNull(raw?.scope),
    targetScope: nombreOuNull(raw?.['target-scope']),
    active: flag(raw?.active),
    dynamic: flag(raw?.dynamic),
    // `static` est un mot réservé en TypeScript : le DTO le renomme.
    isStatic: flag(raw?.static),
    connect: flag(raw?.connect),
    dhcp: flag(raw?.dhcp),
    comment: orNull(raw?.comment),
  };
}

export function mapWirelessInterface(raw: any): WirelessInterfaceDto {
  // `tx-power` n'apparaît que si le mode n'est pas automatique : son absence
  // veut dire « le routeur décide », et non « zéro ».
  const puissance = raw?.['tx-power'];

  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? raw?.['default-name'] ?? '',
    ssid: raw?.ssid ?? '',
    band: raw?.band ?? '',
    channelWidth: raw?.['channel-width'] ?? '',
    frequency: String(raw?.frequency ?? ''),
    mode: raw?.mode ?? '',
    running: flag(raw?.running),
    disabled: flag(raw?.disabled),
    hideSsid: flag(raw?.['hide-ssid']),
    macAddress: raw?.['mac-address'] ?? '',
    securityProfile: raw?.['security-profile'] ?? '',
    country: raw?.country ?? '',
    txPowerDbm: puissance != null && puissance !== '' ? Number(puissance) : null,
  };
}

export function mapWirelessClient(raw: any): WirelessClientDto {
  // RouterOS rend parfois « -63dBm@6Mbps » : on ne garde que les dBm, qui
  // sont ce qui décide de la qualité ressentie.
  const signal = String(raw?.['signal-strength'] ?? '').match(/-?\d+/);

  return {
    id: raw?.['.id'] ?? '',
    interfaceName: raw?.interface ?? '',
    macAddress: raw?.['mac-address'] ?? '',
    signalStrengthDbm: signal ? Number(signal[0]) : null,
    txRate: raw?.['tx-rate'] ?? null,
    rxRate: raw?.['rx-rate'] ?? null,
    uptimeSeconds: raw?.uptime != null ? parseRouterOsDuration(raw.uptime) : null,
  };
}

export function mapRadiusClient(raw: any): RadiusClientDto {
  return {
    id: raw?.['.id'] ?? '',
    // RouterOS met les services dans une seule chaîne séparée par des virgules.
    services: String(raw?.service ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean),
    address: raw?.address ?? '',
    authenticationPort: raw?.['authentication-port'] != null ? Number(raw['authentication-port']) : null,
    accountingPort: raw?.['accounting-port'] != null ? Number(raw['accounting-port']) : null,
    disabled: flag(raw?.disabled),
    timeout: raw?.timeout ?? null,
  };
}

export function mapWireguardInterface(raw: any): WireguardInterfaceDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    listenPort: raw?.['listen-port'] != null ? Number(raw['listen-port']) : null,
    publicKey: raw?.['public-key'] ?? '',
    running: flag(raw?.running),
    disabled: flag(raw?.disabled),
    comment: raw?.comment || null,
  };
}

export function mapWireguardPeer(raw: any): WireguardPeerDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name || null,
    interfaceName: raw?.interface ?? '',
    publicKey: raw?.['public-key'] ?? '',
    // `current-endpoint-address` est ce que le routeur voit réellement ;
    // `endpoint-address` ce qui est configuré. Le second est celui qui compte
    // pour dépanner : c'est lui qu'on a écrit, et souvent lui qui est faux.
    endpointAddress: raw?.['endpoint-address'] || raw?.['current-endpoint-address'] || null,
    endpointPort: raw?.['endpoint-port'] != null ? Number(raw['endpoint-port']) : null,
    allowedAddress: raw?.['allowed-address'] ?? '',
    lastHandshakeSeconds:
      raw?.['last-handshake'] != null ? parseRouterOsDuration(raw['last-handshake']) : null,
    txBytes: Number(raw?.tx ?? 0),
    rxBytes: Number(raw?.rx ?? 0),
    disabled: flag(raw?.disabled),
  };
}

export function mapIpAddress(raw: any): IpAddressDto {
  return {
    id: raw?.['.id'] ?? '',
    address: raw?.address ?? '',
    network: raw?.network ?? '',
    // `actual-interface` résout le cas d'une adresse posée sur un port devenu
    // membre d'un pont : RouterOS garde alors l'interface d'origine dans
    // `interface` et met le pont dans `actual-interface`.
    interfaceName: raw?.['actual-interface'] ?? raw?.interface ?? '',
    dynamique: flag(raw?.dynamic),
    disabled: flag(raw?.disabled),
    invalide: flag(raw?.invalid),
    comment: raw?.comment || null,
  };
}

export function mapBridge(raw: any): BridgeDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    protocolMode: raw?.['protocol-mode'] ?? '',
    vlanFiltering: flag(raw?.['vlan-filtering']),
    running: flag(raw?.running),
    disabled: flag(raw?.disabled),
  };
}

export function mapBridgePort(raw: any): BridgePortDto {
  return {
    id: raw?.['.id'] ?? '',
    interfaceName: raw?.interface ?? '',
    bridgeName: raw?.bridge ?? '',
    inactif: flag(raw?.inactive),
    disabled: flag(raw?.disabled),
  };
}

export function mapDhcpClient(raw: any): DhcpClientDto {
  return {
    id: raw?.['.id'] ?? '',
    interfaceName: raw?.interface ?? '',
    status: raw?.status ?? '',
    address: raw?.address || null,
    gateway: raw?.gateway || null,
    disabled: flag(raw?.disabled),
  };
}
