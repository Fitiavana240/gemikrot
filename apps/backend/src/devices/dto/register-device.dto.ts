import { IsEnum, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { DeviceType } from '@prisma/client';

export class RegisterDeviceDto {
  @Matches(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, {
    message: 'macAddress doit être au format AA:BB:CC:DD:EE:FF',
  })
  macAddress!: string;

  /** Type confirmé par l'admin (la détection ne fait que proposer). */
  @IsEnum(DeviceType)
  type!: DeviceType;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @IsOptional()
  @IsString()
  routerId?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  hostname?: string;
}

export class EnableBypassDto {
  @IsOptional()
  @IsString()
  server?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
