import { IsString } from 'class-validator';

/**
 * Changer son propre mot de passe.
 *
 * L'ancien est exigé même si la session est valide : un écran laissé ouvert
 * ne doit pas suffire à verrouiller quelqu'un hors de son propre compte.
 *
 * Aucune contrainte de longueur sur `currentPassword` — un mot de passe
 * existant plus court que la politique actuelle doit rester saisissable,
 * comme à la connexion. La politique s'applique au nouveau, dans le service.
 */
export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  newPassword!: string;
}
