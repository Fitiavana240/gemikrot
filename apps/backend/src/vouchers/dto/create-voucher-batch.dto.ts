import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

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
}
