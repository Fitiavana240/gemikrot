import { IsEnum, IsInt, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { ProfileStartsWhen } from '@prisma/client';

export class CreatePlanDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsPositive()
  priceAr!: number;

  @IsInt()
  @IsPositive()
  validityDurationSeconds!: number;

  @IsEnum(ProfileStartsWhen)
  startsWhen!: ProfileStartsWhen;

  @IsOptional()
  @IsInt()
  @Min(0)
  rateLimitRxBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  rateLimitTxBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  transferLimitBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxSharedUsers?: number;

  /** Renseigné uniquement pour un abonnement récurrent (ex: 30 jours). */
  @IsOptional()
  @IsInt()
  @Min(1)
  subscriptionPeriodDays?: number;
}
