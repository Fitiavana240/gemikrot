import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateTicketTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  html!: string;

  /** Au-delà de 30 par A4, un ticket ne serait plus lisible. */
  @IsInt()
  @Min(1)
  @Max(30)
  perPage!: number;
}

export class UpdateTicketTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  html?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  perPage?: number;
}

export class PreviewTicketTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  html!: string;

  @IsInt()
  @Min(1)
  @Max(30)
  perPage!: number;
}

export class RenderTicketsDto {
  @IsString()
  templateId!: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  voucherIds?: string[];
}
