import { IsEnum, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreatePaymentDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  planId!: string;

  /** Renseigné pour un renouvellement ; absent pour la vente d'un ticket. */
  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @IsPositive()
  amountAr!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsString()
  reference!: string;
}
