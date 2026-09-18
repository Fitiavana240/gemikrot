import { IsEnum, IsPositive, IsString, IsUUID } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreatePaymentDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  planId!: string;

  @IsPositive()
  amountAr!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsString()
  reference!: string;
}
