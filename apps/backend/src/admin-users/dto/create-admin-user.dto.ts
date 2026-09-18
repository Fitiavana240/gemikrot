import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { AdminRole } from '@prisma/client';

export class CreateAdminUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  /** Seuls OPERATOR et VIEWER sont acceptés (contrôlé côté service). */
  @IsEnum(AdminRole)
  role!: AdminRole;
}
