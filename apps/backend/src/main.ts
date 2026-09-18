import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

// Prisma retourne les colonnes BigInt (ex: Plan.transferLimitBytes) sous
// forme de `bigint`, que JSON.stringify ne sait pas sérialiser nativement.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:5173' });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
