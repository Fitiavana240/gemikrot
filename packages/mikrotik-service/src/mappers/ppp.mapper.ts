import {
  IpPoolDto,
  PppActiveDto,
  PppProfileDto,
  PppSecretDto,
  PppoeServerDto,
} from '../dto/ppp.dto';
import { parseRouterOsDuration, splitRateLimitToken } from './hotspot.mapper';

/**
 * RouterOS n'a pas une seule convention booléenne, il en a deux — et elles
 * coexistent dans le même objet. Sur un profil PPP relevé, `default` vaut
 * `"false"` tandis que `change-tcp-mss` vaut `"yes"` et `use-compression`
 * vaut `"default"`. Ne reconnaître que l'une des deux rendrait `false` sur la
 * moitié des champs, sans jamais lever d'erreur.
 *
 * `"default"` n'est ni vrai ni faux : c'est « hérité », rendu `null`.
 */
function parseFlag(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true' || text === 'yes') return true;
  if (text === 'false' || text === 'no') return false;
  return null;
}

/** Zéro est le « aucune limite » de RouterOS, à distinguer d'un vrai plafond. */
function parsePositiveAmount(value: unknown): number | null {
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Une chaîne vide de RouterOS veut dire « non renseigné », pas « vide ». */
function orNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
  return text === '' ? null : text;
}

/**
 * Date que RouterOS écrit `1970-01-01 00:00:00` quand l'évènement n'a jamais
 * eu lieu, au lieu de laisser le champ vide. Prise au pied de la lettre, elle
 * ferait passer chaque compte neuf pour un abonné déconnecté depuis 1970.
 */
const JAMAIS = '1970-01-01 00:00:00';

export function mapPppSecret(raw: any): PppSecretDto {
  const lastLoggedOut = orNull(raw?.['last-logged-out']);

  return {
    id: raw?.['.id'] ?? '',
    username: raw?.name ?? '',
    disabled: parseFlag(raw?.disabled) === true,
    profile: orNull(raw?.profile),
    // `any` est la valeur par défaut : le compte sert à tous les services.
    service: orNull(raw?.service) ?? 'any',
    comment: orNull(raw?.comment),
    // Le compte peut imposer une adresse ; sinon elle vient du bassin du profil.
    remoteAddress: orNull(raw?.['remote-address']),
    limitBytesIn: parsePositiveAmount(raw?.['limit-bytes-in']),
    limitBytesOut: parsePositiveAmount(raw?.['limit-bytes-out']),
    lastLoggedOut: lastLoggedOut === JAMAIS ? null : lastLoggedOut,
  };
}

export function mapPppProfile(raw: any): PppProfileDto {
  // Un seul jeton « rx/tx » ici, deux champs séparés côté User Manager.
  const rateLimit = splitRateLimitToken(raw?.['rate-limit']);

  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    comment: orNull(raw?.comment),
    isDefault: parseFlag(raw?.default) === true,
    localAddress: orNull(raw?.['local-address']),
    remoteAddress: orNull(raw?.['remote-address']),
    dnsServer: orNull(raw?.['dns-server']),
    rateLimitRxBitsPerSecond: rateLimit.rx,
    rateLimitTxBitsPerSecond: rateLimit.tx,
    onlyOne: parseFlag(raw?.['only-one']),
  };
}

export function mapPppActive(raw: any): PppActiveDto {
  return {
    id: raw?.['.id'] ?? '',
    username: raw?.name ?? '',
    service: orNull(raw?.service) ?? 'pppoe',
    callerId: orNull(raw?.['caller-id']),
    address: orNull(raw?.address),
    uptimeSeconds: parseRouterOsDuration(raw?.uptime),
    // RouterOS omet les compteurs tant que rien n'a transité : zéro octet
    // transmis et « pas encore mesuré » ne se distinguent pas autrement.
    bytesIn: parsePositiveAmount(raw?.['bytes-in']),
    bytesOut: parsePositiveAmount(raw?.['bytes-out']),
  };
}

export function mapPppoeServer(raw: any): PppoeServerDto {
  const maxSessions = raw?.['max-sessions'];

  return {
    id: raw?.['.id'] ?? '',
    serviceName: raw?.['service-name'] ?? '',
    interfaceName: raw?.interface ?? '',
    disabled: parseFlag(raw?.disabled) === true,
    defaultProfile: orNull(raw?.['default-profile']),
    authentication: orNull(raw?.authentication)?.split(',').filter(Boolean) ?? [],
    oneSessionPerHost: parseFlag(raw?.['one-session-per-host']) === true,
    // « unlimited » est une valeur légitime et non numérique : la passer à
    // Number donnerait NaN, qui se propage sans bruit dans tout calcul.
    maxSessions:
      maxSessions == null || maxSessions === 'unlimited' ? null : Number(maxSessions) || null,
  };
}

export function mapIpPool(raw: any): IpPoolDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    ranges: raw?.ranges ?? '',
    // `total` et `used` ne sont rendus que par certaines versions : absents,
    // ils valent `null` plutôt que zéro, qui serait une information fausse.
    total: raw?.total == null ? null : Number(raw.total),
    used: raw?.used == null ? null : Number(raw.used),
    available: raw?.available == null ? null : Number(raw.available),
  };
}
