import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateRouterDto {
  @IsString()
  label!: string;

  @IsString()
  host!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  restPort?: number;

  @IsString()
  username!: string;

  @IsString()
  password!: string;

  /** Empreinte SHA-256 du certificat, pour l'épinglage TLS (Section 35). */
  @IsOptional()
  @IsString()
  tlsFingerprint?: string;
}

export class UpdateRouterDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  restPort?: number;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  tlsFingerprint?: string;
}

export class ProbeFingerprintDto {
  @IsString()
  host!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsBoolean()
  save?: boolean;
}
