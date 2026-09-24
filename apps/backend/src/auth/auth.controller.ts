import { Body, Controller, Get, Ip, Post } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthenticatedUser } from './jwt.strategy.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { SignupDto } from './dto/signup.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { Public } from './public.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  /** Inscription d'un exploitant — le compte reste inactif jusqu'à validation. */
  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto, @Ip() ip: string) {
    return this.authService.signup(dto, ip);
  }

  /**
   * Changer son propre mot de passe.
   *
   * Pas de `@Public()` : c'est le seul endpoint d'`auth` qui exige une
   * session. Il ne prend pas d'identifiant d'utilisateur en paramètre non
   * plus — on ne change que le sien, celui que porte le jeton.
   */
  /**
   * Confirme l'adresse a partir du code recu.
   *
   * Pas de `@Public()` : le compte existe deja et il est connecte. On ne
   * confirme pas l'adresse de quelqu'un d'autre, et un code a six chiffres
   * ne suffirait pas a authentifier quoi que ce soit.
   */
  @Post('confirmer-courriel')
  confirmerCourriel(@CurrentUser() user: AuthenticatedUser, @Body() body: { code: string }) {
    return this.authService.confirmerCourriel(user.id, body.code);
  }

  /** Un nouveau code, au plus un par minute. */
  @Post('renvoyer-code')
  renvoyerLeCode(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.renvoyerLeCode(user.id);
  }

  /**
   * La plateforme sait-elle ecrire ?
   *
   * Le bandeau de confirmation le demande avant de reclamer un code : si la
   * reponse est non, aucun code n'arrivera jamais et le champ n'a rien a
   * faire a l'ecran. Un booleen, rien du reglage.
   */
  @Get('courriel-plateforme')
  courrielPlateforme() {
    return this.authService.plateformePeutEcrire();
  }

  @Post('change-password')
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.authService.changePassword(user.id, dto, ip);
  }
}
