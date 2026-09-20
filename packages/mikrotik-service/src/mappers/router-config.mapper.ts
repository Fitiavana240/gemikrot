import {
  HotspotServicePortDto,
  UmAttributeDto,
  UmRouterDto,
  UmUserGroupDto,
} from '../dto/router-config.dto';

/** RouterOS rend ses booléens en chaînes. */
function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

/** Une chaîne vide de RouterOS veut dire « non renseigné », pas « vide ». */
function orNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
  return text === '' ? null : text;
}

/** Liste séparée par des espaces ou des virgules, selon le champ. */
function liste(value: unknown): string[] {
  return String(value ?? '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Un client RADIUS de User Manager.
 *
 * Le secret partagé est **volontairement absent** du résultat : il
 * authentifie le routeur auprès de RADIUS, et le laisser remonter jusqu'au
 * navigateur reviendrait à le publier. Seule sa présence est rendue.
 */
export function mapUmRouter(raw: any): UmRouterDto {
  const coa = raw?.['coa-port'];
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    address: raw?.address ?? '',
    protocol: orNull(raw?.protocol) ?? 'udp',
    coaPort: coa == null || coa === '' ? null : Number(coa) || null,
    disabled: flag(raw?.disabled),
    hasSharedSecret: Boolean(orNull(raw?.['shared-secret'])),
  };
}

export function mapUmUserGroup(raw: any): UmUserGroupDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    outerAuths: liste(raw?.['outer-auths']),
    innerAuths: liste(raw?.['inner-auths']),
    attributes: orNull(raw?.attributes),
    isDefault: flag(raw?.default),
  };
}

/** `standard` n'est pas un constructeur : c'est l'absence de constructeur. */
function vendorOuNull(value: unknown): string | null {
  const texte = orNull(value);
  return texte === null || texte.toLowerCase() === 'standard' ? null : texte;
}

export function mapUmAttribute(raw: any): UmAttributeDto {
  const typeId = raw?.['type-id'];
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    standardName: orNull(raw?.['standard-name']),
    typeId: typeId == null || typeId === '' ? null : Number(typeId),
    valueType: orNull(raw?.['value-type']),
    // Le routeur rend la chaîne « standard » plutôt que d'omettre le champ :
    // la prendre pour un identifiant afficherait « constructeur standard ».
    // Relevé sur le hAP — la documentation laissait croire à un champ absent.
    vendorId: vendorOuNull(raw?.['vendor-id']),
    packetTypes: liste(raw?.['packet-types']),
    isDefault: flag(raw?.default),
  };
}

export function mapHotspotServicePort(raw: any): HotspotServicePortDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    ports: raw?.ports ?? '',
    disabled: flag(raw?.disabled),
  };
}
