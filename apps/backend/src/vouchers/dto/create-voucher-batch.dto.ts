import { VoucherTarget } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

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

  @IsOptional()
  @IsString()
  prefix?: string;

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
