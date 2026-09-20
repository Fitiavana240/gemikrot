import {
  ArpEntryDto,
  DhcpServerDto,
  IpCloudDto,
  IpServiceDto,
  NetworkInterfaceStatsDto,
  PaireDto,
  RouterLogEntryDto,
  SimpleQueueDto,
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
