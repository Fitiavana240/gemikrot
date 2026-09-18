import { IsEnum, IsString, Matches } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class MobileMoneyAccountDto {
  @IsEnum(PaymentMethod)
  provider!: PaymentMethod;

  @Matches(/^\+?[0-9 ]{7,15}$/, { message: 'Numéro Mobile Money invalide' })
  phoneNumber!: string;

  /** Nom du titulaire de la puce, affiché au client au moment de payer. */
  @IsString()
  accountName!: string;
}
