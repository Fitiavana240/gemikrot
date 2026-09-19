import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { PublicService } from './public.service.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { ClaimPaymentDto, LookupClaimDto } from './dto/public.dto.js';
import { normalizePhone, normalizeReference } from './payment-normalization.js';

/**
 * Seules routes du système ouvertes sans jeton.
 *
 * `@Public()` seul suffit : `RolesGuard` laisse passer ce qui ne porte pas de
 * `@Roles()`. La limitation de débit est donc la seule barrière, et elle
 * s'appuie d'abord sur des clés métier — derrière le portail captif, tous les
 * clients partagent l'adresse du routeur.
 */
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get(':slug')
  @UseGuards(
    new RateLimitGuard([
      {
        key: (req) => `${req.params.slug}:${req.ip}`,
        limit: 60,
        windowMs: 60_000,
        message: 'Trop de requêtes.',
      },
    ]),
  )
  getTenant(@Param('slug') slug: string) {
    return this.publicService.getTenantView(slug);
  }

  @Post(':slug/claim')
  @UseGuards(
    new RateLimitGuard([
      {
        // Un client honnête déclare un paiement, pas dix par heure.
        key: (req) => `${req.params.slug}:${normalizePhone(req.body?.phone ?? '')}`,
        limit: 10,
        windowMs: 3_600_000,
        message: 'Trop de tentatives pour ce numéro.',
      },
      {
        key: (req) => `${req.params.slug}:${normalizeReference(req.body?.reference ?? '')}`,
        limit: 20,
        windowMs: 3_600_000,
        message: 'Trop de tentatives pour cette référence.',
      },
      {
        // Filet contre un automate extérieur, volontairement large : le
        // portail captif fait partager une seule adresse à tout le quartier.
        key: (req) => req.ip,
        limit: 120,
        windowMs: 60_000,
        message: 'Trop de requêtes.',
      },
    ]),
  )
  claim(@Param('slug') slug: string, @Body() dto: ClaimPaymentDto) {
    return this.publicService.claim(slug, dto);
  }

  @Get(':slug/claim/:token')
  @UseGuards(
    new RateLimitGuard([
      {
        // Le suivi est interrogé en boucle par la page d'attente : la
        // limite doit tolérer un rafraîchissement toutes les trois secondes.
        key: (req) => `${req.params.slug}:${req.ip}`,
        limit: 120,
        windowMs: 60_000,
        message: 'Trop de requêtes.',
      },
    ]),
  )
  getClaim(@Param('slug') slug: string, @Param('token') token: string) {
    return this.publicService.getClaimByToken(slug, token);
  }

  @Post(':slug/lookup')
  @UseGuards(
    new RateLimitGuard([
      {
        key: (req) => `${req.params.slug}:${normalizePhone(req.body?.phone ?? '')}`,
        limit: 20,
        windowMs: 3_600_000,
        message: 'Trop de recherches pour ce numéro.',
      },
      {
        key: (req) => req.ip,
        limit: 60,
        windowMs: 60_000,
        message: 'Trop de requêtes.',
      },
    ]),
  )
  lookup(@Param('slug') slug: string, @Body() dto: LookupClaimDto) {
    return this.publicService.lookup(slug, dto);
  }
}
