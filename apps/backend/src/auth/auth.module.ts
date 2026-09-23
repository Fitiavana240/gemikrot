import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module.js';
import { CourrielModule } from '../courriel/courriel.module.js';
import { AuthService } from './auth.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './jwt.strategy.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  imports: [
    AuditModule,
    // Prevenir la plateforme qu'un exploitant vient de s'inscrire.
    CourrielModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // `expiresIn` accepte un nombre de secondes ou une chaîne "12h"/"7d"
        // (type `StringValue` de la lib `ms`, non exporté par @nestjs/jwt).
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '12h') as never },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginThrottleService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
