import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  wifiName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  domains?: string[];

  @IsOptional()
  @IsString()
  logoUrl?: string;

  /**
   * Numero WhatsApp d'assistance, au format que `wa.me` accepte.
   *
   * Chiffres seuls, indicatif pays compris, sans « + » ni espaces :
   * `261340000000`. La chaine vide est admise et vaut « pas d'assistance » —
   * sans quoi on ne pourrait plus retirer un numero une fois pose.
   */
  @IsOptional()
  @IsString()
  @Matches(/^$|^[1-9][0-9]{7,14}$/, {
    message:
      'Le numero WhatsApp doit etre au format international sans « + » ni espaces, par exemple 261340000000',
  })
  supportWhatsapp?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3, { message: 'La devise doit être un code ISO de 3 lettres (MGA, USD, EUR…)' })
  currency?: string;
}
