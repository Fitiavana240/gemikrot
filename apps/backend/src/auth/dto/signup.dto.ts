import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class MobileMoneyAccountInput {
  @IsEnum(PaymentMethod)
  provider!: PaymentMethod;

  @Matches(/^\+?[0-9 ]{7,15}$/, { message: 'Numéro Mobile Money invalide' })
  phoneNumber!: string;

  /** Nom du titulaire de la puce, affiché au client qui paie. */
  @IsString()
  accountName!: string;
}

export class SignupDto {
  @IsString()
  organizationName!: string;

  /** Nom du réseau Wi-Fi vu par les clients finaux. */
  @IsString()
  wifiName!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  domains?: string[];

  @IsOptional()
  @IsString()
  logoUrl?: string;

  /** Code ISO 4217 : MGA, USD, EUR… */
  @IsString()
  @Length(3, 3, { message: 'La devise doit être un code ISO de 3 lettres (MGA, USD, EUR…)' })
  currency!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MobileMoneyAccountInput)
  @ArrayMaxSize(10)
  mobileMoneyAccounts?: MobileMoneyAccountInput[];
}
