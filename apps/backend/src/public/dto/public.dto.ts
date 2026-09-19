import { IsString, MaxLength, MinLength } from 'class-validator';

export class ClaimPaymentDto {
  @IsString()
  planId!: string;

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
