import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  // Aucune contrainte de longueur ici : un mot de passe existant mais court
  // doit pouvoir être saisi. La politique de robustesse s'applique à la
  // création/modification du mot de passe, pas à la connexion.
  @IsString()
  password!: string;
}
