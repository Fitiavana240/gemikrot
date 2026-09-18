import { Injectable } from '@nestjs/common';
import { DeviceType } from '@prisma/client';

export interface DeviceDetection {
  type: DeviceType;
  /** Ce qui a permis de conclure, affiché à l'admin pour qu'il tranche. */
  source: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Motifs de nom DHCP, du plus spécifique au plus générique. Le nom d'hôte est
 * le signal le plus fiable dont dispose le routeur ("OPPO-A15-Pro").
 */
const HOSTNAME_PATTERNS: { pattern: RegExp; type: DeviceType }[] = [
  { pattern: /(smart-?tv|bravia|android-?tv|chromecast|roku|firetv|\btv\b)/i, type: DeviceType.TV },
  { pattern: /(hikvision|dahua|tapo|ezviz|ipcam|\bcam\b|camera)/i, type: DeviceType.CAMERA },
  { pattern: /(desktop-|laptop-|macbook|imac|thinkpad|latitude|\bpc\b)/i, type: DeviceType.COMPUTER },
  {
    pattern: /(iphone|ipad|galaxy|oppo|redmi|xiaomi|poco|huawei|tecno|infinix|itel|vivo|realme|nokia|android)/i,
    type: DeviceType.PHONE,
  },
  { pattern: /(mikrotik|tp-?link|archer|routeur|router|repeater|\bap\b)/i, type: DeviceType.ROUTER },
];

/**
 * Préfixes OUI observés sur le réseau WIFI-TATI. Volontairement court : une
 * base OUI complète (~30 000 entrées) n'apporterait pas plus, puisque le
 * fabricant ne dit pas le type d'appareil (Samsung fait TV et téléphones) et
 * que l'admin confirme de toute façon.
 */
const OUI_VENDORS: Record<string, string> = {
  'C0:8A:60': 'Samsung',
  'D0:65:B3': 'Samsung',
  'E0:75:26': 'Samsung',
  '6C:D7:1F': 'OPPO',
  '8C:25:05': 'Huawei',
  'BC:1D:89': 'Xiaomi',
  'A8:9C:ED': 'Xiaomi',
  '20:F4:78': 'Xiaomi',
};

@Injectable()
export class DeviceDetectionService {
  /**
   * Propose un type d'appareil. Ne décide jamais seul : le résultat est
   * soumis à l'admin, qui confirme avant qu'un contournement du portail
   * captif ne soit créé sur le routeur.
   */
  detect(input: {
    macAddress?: string | null;
    hostname?: string | null;
    /** Commentaire posé sur le routeur, souvent plus parlant que le nom DHCP. */
    comment?: string | null;
  }): DeviceDetection {
    const candidates = [
      { value: input.comment?.trim(), label: 'commentaire routeur' },
      { value: input.hostname?.trim(), label: 'nom DHCP' },
    ].filter((candidate): candidate is { value: string; label: string } => !!candidate.value);

    for (const { value, label } of candidates) {
      for (const { pattern, type } of HOSTNAME_PATTERNS) {
        if (pattern.test(value)) {
          return { type, source: `${label} "${value}"`, confidence: 'high' };
        }
      }
    }

    const vendor = this.lookupVendor(input.macAddress);
    if (vendor) {
      return {
        type: DeviceType.OTHER,
        source: `fabricant ${vendor} (MAC) — type non déductible`,
        confidence: 'low',
      };
    }

    const unrecognized = candidates[0];
    return {
      type: DeviceType.OTHER,
      source: unrecognized
        ? `${unrecognized.label} "${unrecognized.value}" non reconnu`
        : 'aucun nom DHCP annoncé',
      confidence: 'low',
    };
  }

  /** Un appareil sans navigateur ne peut pas afficher la page captive. */
  requiresBypass(type: DeviceType): boolean {
    return type === DeviceType.TV || type === DeviceType.CAMERA;
  }

  private lookupVendor(macAddress?: string | null): string | undefined {
    if (!macAddress) return undefined;
    return OUI_VENDORS[macAddress.slice(0, 8).toUpperCase()];
  }
}
