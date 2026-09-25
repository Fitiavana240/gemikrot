import { VoucherTarget } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateVoucherBatchDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsUUID()
  routerId?: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;

  /** Le debut de l'identifiant, tel qu'il sera imprime : `H` donne `H4KP82…`. */
  @IsOptional()
  @IsString()
  @MaxLength(12)
  prefix?: string;

  /**
   * Combien de caracteres apres le prefixe.
   *
   * Tires au hasard sur un alphabet sans caracteres ambigus -- ni `0/O`, ni
   * `1/I/l` -- parce qu'un client retape ce code a la main sur un telephone.
   * Court, il se tape vite et se devine plus vite ; le plancher de quatre est
   * la pour qu'un lot de cent ne se remplisse pas de collisions.
   */
  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(16)
  codeLength?: number;

  /**
   * Le debut du mot de passe, quand il differe de l'identifiant.
   *
   * **Renseigne, le mot de passe cesse d'etre le code.** C'etait une decision
   * assumee -- le client n'avait qu'une chose a recopier, et aucune erreur
   * possible entre deux lignes. Le ticket imprime en portera desormais deux,
   * et le marqueur `password` du modele les distingue deja.
   */
  @IsOptional()
  @IsString()
  @MaxLength(12)
  passwordPrefix?: string;

  /** Court a dessein : c'est la seconde ligne a recopier. */
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(12)
  passwordLength?: number;

  /**
   * Ou creer les comptes de ce lot.
   *
   * Par defaut User Manager, et c'est le bon choix : lui seul tient une
   * validite **calendaire**, qui continue de courir client deconnecte. Sur
   * le HotSpot, le plafond compte le temps passe connecte — un forfait d'un
   * mois y deviendrait 720 h de connexion, ce qui n'est pas le meme produit.
   *
   * La cible HotSpot existe pour les routeurs ou User Manager n'est pas
   * installe, et pour les tickets courts que le parc vend deja ainsi.
   */
  @IsOptional()
  @IsEnum(VoucherTarget)
  target?: VoucherTarget;
}
