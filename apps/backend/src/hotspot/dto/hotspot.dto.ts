import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
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
   * `limit-uptime` côté RouterOS. 400 des 646 comptes du parc en portent un
   * — `2h` pour un ticket à 500 Ar.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  limitUptimeSeconds?: number | null;
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
}
