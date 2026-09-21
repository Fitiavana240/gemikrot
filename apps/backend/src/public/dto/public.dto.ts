import { IsString, MaxLength, MinLength } from 'class-validator';

export class ClaimPaymentDto {
  @IsString()
  planId!: string;

  /**
   * Le nom du client, qui deviendra son identifiant de connexion.
   *
   * Normalise cote service : accents retires, espaces recolles. La borne
   * haute est large parce qu'un nom complet est plus long que
   * l'identifiant qu'on en tire.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  holderName!: string;

  @IsString()
  accountId!: string;

  /** Normalisé côté service : toutes les écritures d'un numéro s'y ramènent. */
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(40)
  reference!: string;
}

export class LookupClaimDto {
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(40)
  reference!: string;
}
