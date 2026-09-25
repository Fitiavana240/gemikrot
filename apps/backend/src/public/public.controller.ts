import { Body, Controller, Get, Header, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
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

  /**
   * A qui appartient l'adresse par laquelle on est arrive ?
   *
   * Deux segments, et non un : `:slug` en consomme un seul, donc aucune
   * collision possible avec l'exploitant qui s'appellerait << hote >>.
   *
   * `?hote=` existe pour se tester sans DNS : la reponse ne contient qu'un
   * slug, qui est deja dans l'adresse publique imprimee sur les tickets. Rien
   * n'est divulgue ici que le QR d'un ticket ne dise deja.
   */
  @Get('resolution/hote')
  @UseGuards(
    new RateLimitGuard([
      { key: (req) => `hote:${req.ip}`, limit: 60, windowMs: 60_000, message: 'Trop de requêtes.' },
    ]),
  )
  async resoudreHote(@Req() req: Request, @Query('hote') hote?: string) {
    // `req.hostname` derriere un proxy ne vaut que si `trust proxy` est pose ;
    // l'en-tete transmise par le proxy est donc lue en premier, et elle peut
    // contenir une liste -- le premier element est le client.
    const transmis = String(req.headers['x-forwarded-host'] ?? '').split(',')[0];
    // `req.headers.host` plutot que `req.hostname` : le second retire le port,
    // et c'est justement lui qui distingue la page de paiement de la console
    // quand les deux repondent sur la meme machine.
    const brut = String(req.headers.host ?? '');
    return (
      (await this.publicService.slugParHote(hote || transmis || brut || req.hostname)) ?? {
        slug: null,
      }
    );
  }

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
  getTenant(@Param('slug') slug: string, @Query('r') routeur?: string) {
    // `?r=` et non un segment de plus : l'adresse est gravee dans la page
    // captive de chaque routeur, et une page posee avant cette version
    // continue de repondre sans lui.
    return this.publicService.getTenantView(slug, routeur);
  }

  /**
   * La page de connexion du portail, telle que le routeur doit l'ecrire.
   *
   * C'est **le routeur** qui appelle cette adresse, par `/tool/fetch`, et qui
   * depose le resultat dans son dossier HotSpot. Rien d'autre ne la lit.
   *
   * `text/html` et non du JSON : ce que `fetch` recupere est ecrit tel quel
   * dans le fichier, octet pour octet.
   */
  @Get(':slug/page-captive')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @UseGuards(
    new RateLimitGuard([
      {
        // Un routeur pose sa page une fois, pas cent. Large tout de meme :
        // un parc entier peut se reconfigurer le meme jour.
        key: (req) => `page:${req.ip}`,
        limit: 30,
        windowMs: 3_600_000,
        message: 'Trop de requêtes.',
      },
    ]),
  )
  pageCaptive(@Param('slug') slug: string, @Query('r') routeur?: string) {
    return this.publicService.pageCaptive(slug, routeur);
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
