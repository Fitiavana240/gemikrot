import { IsOptional, IsString, Matches } from 'class-validator';

export class RegisterDeviceDto {
  @Matches(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, { message: 'macAddress doit être au format AA:BB:CC:DD:EE:FF' })
  macAddress!: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  hostname?: string;

  @IsOptional()
  @IsString()
  deviceType?: string;
}
