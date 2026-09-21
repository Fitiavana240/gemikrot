import { Body, Controller, Ip, Post } from '@nestjs/common';
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
  @Post('change-password')
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.authService.changePassword(user.id, dto, ip);
  }
}
