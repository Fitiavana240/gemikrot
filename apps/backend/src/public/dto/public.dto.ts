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

/**
 * Racheter du temps sur un acces existant.
 *
 * Trois choses, et pas une de plus : qui on est, la preuve qu'on l'est, et le
 * paiement qu'on vient de faire. Le numero de telephone n'y figure pas -- il
 * est sur la fiche du client depuis son premier achat, et le retaper ne
 * serait qu'une occasion de se tromper.
 */
export class ReabonnerDto {
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  identifiant!: string;

  /**
   * La reference du premier achat, qui est aussi son mot de passe.
   *
   * Elle sert de preuve : sans elle, n'importe qui pourrait prolonger le
   * compte d'un autre -- ou, bien pire, se tromper d'un caractere et payer
   * pour quelqu'un d'autre sans jamais comprendre pourquoi rien ne s'ouvre.
   */
  @IsString()
  @MinLength(4)
  @MaxLength(40)
  motDePasse!: string;

  @IsString()
  planId!: string;

  @IsString()
  accountId!: string;

  /** La reference du nouveau transfert. */
  @IsString()
  @MinLength(4)
  @MaxLength(40)
  reference!: string;
}
