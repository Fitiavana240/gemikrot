import { IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsString()
  routerId?: string;

  /** Nom du compte créé dans `/ip/hotspot/user`. */
  @Matches(/^[a-zA-Z0-9_.@-]+$/, { message: 'Nom de compte HotSpot invalide' })
  hotspotUsername!: string;

  @IsString()
  @MinLength(4)
  password!: string;
}
