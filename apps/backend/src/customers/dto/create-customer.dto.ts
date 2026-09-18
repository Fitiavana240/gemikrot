import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  name!: string;

  @Matches(/^\+?[0-9 ]{7,15}$/, { message: 'phone doit être un numéro valide' })
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
