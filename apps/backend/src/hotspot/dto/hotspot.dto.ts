import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Un port ou une plage. RouterOS refuse une liste séparée par des virgules
 * sur ces listes : ouvrir deux ports distincts demande deux entrées.
 */
const PORT = /^\d{1,5}(-\d{1,5})?$/;

export class CreateWalledGardenDto {
  /** Nom de domaine, éventuellement avec joker : `*.mvola.mg`. */
  @IsString()
  @MinLength(3)
  @MaxLength(253)
  @Matches(/^[a-zA-Z0-9*._-]+$/, { message: 'Nom de domaine invalide' })
  dstHost!: string;

  @IsOptional()
  @IsIn(['allow', 'deny'])
  action?: 'allow' | 'deny';

  @IsOptional()
  @IsString()
  @Matches(PORT, { message: 'Un port ou une plage (3000 ou 3000-3010)' })
  dstPort?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  comment?: string;
}

export class CreateWalledGardenIpDto {
  /** Adresse ou réseau : `192.0.2.7` ou `192.0.2.0/24`. */
  @IsString()
  @MinLength(7)
  @MaxLength(43)
  @Matches(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, { message: 'Adresse invalide' })
  dstAddress!: string;

  @IsOptional()
  @IsIn(['accept', 'drop', 'reject'])
  action?: 'accept' | 'drop' | 'reject';

  @IsOptional()
  @IsString()
  @Matches(PORT, { message: 'Un port ou une plage (3000 ou 3000-3010)' })
  dstPort?: string;

  @IsOptional()
  @IsIn(['tcp', 'udp', 'icmp'])
  protocol?: 'tcp' | 'udp' | 'icmp';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  comment?: string;
}

/**
 * Création d'un compte HotSpot.
 *
 * À distinguer d'un ticket User Manager : ici la validité n'est pas
 * calendaire. Le plafond porte sur le temps **passé connecté** et ne
 * s'écoule pas pendant que le client est déconnecté.
 */
export class CreateHotspotUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  profileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  server?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  comment?: string;

  /**
   * Lier ce compte a un appareil : la session s'ouvre seule.
   *
   * **C'est la seule facon d'avoir l'automatisme du contournement ET une
   * echeance.** Un contournement fait passer l'appareil avant le portail : il
   * n'ouvre aucune session, donc aucune limite de temps ne s'applique et rien
   * ne l'arrete jamais. Un compte lie a une MAC ouvre une vraie session -- le
   * client ne voit pas plus de page de connexion, mais le profil s'applique,
   * et le compte expire.
   *
   * Exige `login-by=mac` sur le profil du serveur HotSpot.
   */
  @IsOptional()
  @IsString()
  @Matches(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, {
    message: 'Adresse MAC invalide (AA:BB:CC:DD:EE:FF)',
  })
  macAddress?: string;

  /**
   * `limit-uptime` côté RouterOS. 400 des 646 comptes du parc en portent un
   * — `2h` pour un ticket à 500 Ar.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  limitUptimeSeconds?: number | null;

  /**
   * Quotas portés par **le compte**, indépendants du profil.
   *
   * Le profil borne une session ; ceux-ci bornent l'accès vendu, et se
   * règlent ticket par ticket. `null` retire le plafond, absent n'y touche pas.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  limitBytesIn?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  limitBytesOut?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  limitBytesTotal?: number | null;
}

/** Ne modifie que ce qui est fourni. Le nom identifie le compte. */
export class UpdateHotspotUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  profileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  comment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  server?: string;

  /** `null` retire le plafond ; absent n'y touche pas. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  limitUptimeSeconds?: number | null;

  /**
   * Quotas portés par **le compte**, indépendants du profil.
   *
   * Le profil borne une session ; ceux-ci bornent l'accès vendu, et se
   * règlent ticket par ticket. `null` retire le plafond, absent n'y touche pas.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  limitBytesIn?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  limitBytesOut?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  limitBytesTotal?: number | null;
}

/**
 * Modification d'un profil HotSpot. Seul ce qui est fourni est écrit.
 *
 * Le nom n'y figure pas : sur RouterOS il **est** l'identifiant du profil, et
 * le changer reviendrait à en créer un autre en abandonnant les comptes qui
 * pointent vers le premier.
 */
export class UpdateHotspotProfileDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  rateLimitRxBitsPerSecond?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  rateLimitTxBitsPerSecond?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  sessionTimeoutSeconds?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  sharedUsers?: number;

  /** `null` retire le délai ; absent n'y touche pas. */
  @IsOptional()
  @IsInt()
  @Min(0)
  idleTimeoutSeconds?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  keepaliveTimeoutSeconds?: number | null;

  /**
   * Poser un cookie à la connexion, ou non.
   *
   * Le couper rend le blocage d'un compte immédiat, au prix d'une saisie du
   * code à chaque reconnexion : c'est un arbitrage commercial, et il se prend
   * ici plutôt que dans WinBox.
   */
  @IsOptional()
  @IsBoolean()
  addMacCookie?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  macCookieTimeoutSeconds?: number | null;
}

/**
 * Un contournement du portail, et la limite qui l'accompagne.
 *
 * **Les deux au même geste.** Un appareil contourné ne se connecte jamais :
 * il n'a ni compte ni profil HotSpot, donc aucune des limites que porte un
 * profil. Revenir poser la limite plus tard suppose de savoir qu'elle manque,
 * et rien ne le dit — l'appareil marche très bien, il prend simplement toute
 * la ligne.
 */
export class CreateIpBindingDto {
  /** `AA:BB:CC:DD:EE:FF`, séparateurs deux-points ou tirets. */
  @IsString()
  @Matches(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/, {
    message: 'Adresse MAC invalide (AA:BB:CC:DD:EE:FF)',
  })
  macAddress!: string;

  @IsIn(['regular', 'bypassed', 'blocked'])
  type!: 'regular' | 'bypassed' | 'blocked';

  /**
   * L'adresse fixe de cet appareil. Facultative pour contourner, **exigée
   * pour limiter** : les files de RouterOS visent une adresse, pas une MAC.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  server?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  comment?: string;

  /**
   * Ce que l'appareil envoie, en bits par seconde.
   *
   * Les deux sens vont ensemble : `max-limit` est un seul champ à deux
   * membres que RouterOS remplace en entier. N'en donner qu'un effacerait
   * l'autre, et une limite descendante effacée ne se voit pas.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  limiteMontanteBps?: number;

  /** Ce que l'appareil reçoit — le chiffre perçu comme « le débit ». */
  @IsOptional()
  @IsInt()
  @IsPositive()
  limiteDescendanteBps?: number;
}

export class ChangerTypeContournementDto {
  @IsIn(['regular', 'bypassed', 'blocked'])
  type!: 'regular' | 'bypassed' | 'blocked';
}
