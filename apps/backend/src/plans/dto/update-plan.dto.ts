import { IsEnum, IsInt, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { ProfileStartsWhen } from '@prisma/client';

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsPositive()
  priceAr?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  validityDurationSeconds?: number;

  @IsOptional()
  @IsEnum(ProfileStartsWhen)
  startsWhen?: ProfileStartsWhen;

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
}
