import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWalledGardenDto {
  /** Nom de domaine, éventuellement avec joker : `*.mvola.mg`. */
  @IsString()
  @MinLength(3)
  @MaxLength(253)
  @Matches(/^[a-zA-Z0-9*._-]+$/, { message: 'Nom de domaine invalide' })
  dstHost!: string;

  @IsOptional()
  @IsIn(['allow', 'deny'])
  action?: 'allow' | 'deny';

  @IsOptional()
  @IsString()
  @Matches(/^[0-9,-]+$/, { message: 'Port invalide' })
  dstPort?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  comment?: string;
}

export class CreateWalledGardenIpDto {
  /** Adresse ou réseau : `192.0.2.7` ou `192.0.2.0/24`. */
  @IsString()
  @MinLength(7)
  @MaxLength(43)
  @Matches(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, { message: 'Adresse invalide' })
  dstAddress!: string;

  @IsOptional()
  @IsIn(['accept', 'drop', 'reject'])
  action?: 'accept' | 'drop' | 'reject';

  @IsOptional()
  @IsString()
  @Matches(/^[0-9,-]+$/, { message: 'Port invalide' })
  dstPort?: string;

  @IsOptional()
  @IsIn(['tcp', 'udp', 'icmp'])
  protocol?: 'tcp' | 'udp' | 'icmp';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  comment?: string;
}
