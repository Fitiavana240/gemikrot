import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateTenantDto {
  /**
   * L'identifiant public, celui qui se lit dans l'adresse de la page de
   * paiement : `/p/zone-wifi-tati`.
   *
   * Modifiable, parce qu'il s'affiche au client et que le mot derive du nom
   * de l'exploitant a l'inscription -- rarement celui qu'il aurait choisi.
   *
   * Minuscules, chiffres et tirets : il voyage dans une adresse, et une
   * majuscule ou un espace y devient illisible une fois encode.
   */
  @IsOptional()
  @IsString()
  @Length(3, 40)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      'L\u2019identifiant public ne prend que des minuscules, des chiffres et des tirets : zone-wifi-tati',
  })
  slug?: string;

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
