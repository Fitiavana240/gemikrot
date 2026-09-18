import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsIn,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Le nom transite par l'URL REST du routeur : le jeu de caractères est
 * volontairement restreint, à l'identique des schémas du paquet MikroTik.
 * La double validation est assumée — c'est la doctrine du projet : ne jamais
 * laisser une valeur malformée atteindre RouterOS.
 */
const ROUTEROS_NAME = /^[a-zA-Z0-9_.-]+$/;

export class CreateUserManagerProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(ROUTEROS_NAME, { message: 'Caractères non autorisés dans le nom du profil' })
  name!: string;

  /** `null` = validité illimitée, valeur légitime côté RouterOS. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  validityDurationSeconds!: number | null;

  @IsIn(['first-auth', 'assigned'])
  startsWhen!: 'first-auth' | 'assigned';

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  sharedUsers?: number;
}

export class UpdateUserManagerProfileDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  validityDurationSeconds?: number | null;

  @IsOptional()
  @IsIn(['first-auth', 'assigned'])
  startsWhen?: 'first-auth' | 'assigned';

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  sharedUsers?: number;
}

export class CreateLimitationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(ROUTEROS_NAME, { message: 'Caractères non autorisés dans le nom de la limitation' })
  name!: string;

  /** `null` sur un plafond veut dire « aucune limite ». */
  @IsOptional()
  @IsInt()
  @IsPositive()
  rateLimitRxBitsPerSecond?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  rateLimitTxBitsPerSecond?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  transferLimitBytes?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  uptimeLimitSeconds?: number | null;
}

export class UpdateLimitationDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  rateLimitRxBitsPerSecond?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  rateLimitTxBitsPerSecond?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  transferLimitBytes?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  uptimeLimitSeconds?: number | null;
}

export class AttachLimitationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  limitationName!: string;
}

export class CreateAccountDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(ROUTEROS_NAME, { message: 'Caractères non autorisés dans le nom du compte' })
  username!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  profileName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  sharedUsers?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  comment?: string;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  sharedUsers?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  comment?: string;
}

export class SetAccountDisabledDto {
  @IsBoolean()
  @Type(() => Boolean)
  disabled!: boolean;
}

export class AssignProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  profileName!: string;
}
