import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { MikrotikExceptionFilter } from './routers/mikrotik-exception.filter.js';

// Prisma retourne les colonnes BigInt (ex: Plan.transferLimitBytes) sous
// forme de `bigint`, que JSON.stringify ne sait pas sérialiser nativement.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  // `rawBody` conserve le corps de la requête tel qu'il est arrivé : la
  // signature du webhook SMS porte sur les octets reçus, pas sur un objet
  // re-sérialisé, dont l'ordre des clés et les espaces différeraient.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.use(helmet());

  // Derrière le portail captif, le routeur relaie les requêtes des clients :
  // sans cette option elles arrivent toutes avec l'adresse du routeur, et une
  // limite de débit par IP bannirait tout le quartier d'un coup.
  app.set('trust proxy', 1);

  // Sans ce filtre, une panne de routeur — un câble, une coupure, un tunnel
  // tombé — rend à l'écran « Internal server error », la phrase qui désigne
  // un défaut de la console. On cherche alors le problème du mauvais côté.
  app.useGlobalFilters(new MikrotikExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:5173' });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
