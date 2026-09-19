import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  /** Clé métier, dérivée de la requête. `null` = règle non applicable ici. */
  key: (request: any) => string | null;
  limit: number;
  windowMs: number;
  message: string;
}

/**
 * Limitation de débit des points d'entrée publics.
 *
 * Écrite sur mesure plutôt qu'empruntée, pour une raison de fond : derrière
 * le portail captif, **tous les clients partagent l'adresse du routeur**. Une
 * limite par IP bannirait le quartier entier dès qu'une personne insiste. Les
 * clés qui comptent sont métier — le téléphone, la référence — et l'IP ne
 * sert que de filet contre un automate extérieur.
 *
 * Le compteur vit en mémoire : suffisant tant qu'un seul processus sert
 * l'application. À déplacer dans Redis le jour où il y en a deux, et c'est
 * écrit ici pour que la question se pose à ce moment-là plutôt qu'après.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, Window>();
  private lastSweep = Date.now();

  constructor(private readonly rules: RateLimitRule[]) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const now = Date.now();
    this.sweep(now);

    for (const rule of this.rules) {
      const key = rule.key(request);
      if (key === null) continue;

      const bucket = `${rule.message}:${key}`;
      const window = this.windows.get(bucket);

      if (!window || window.resetAt <= now) {
        this.windows.set(bucket, { count: 1, resetAt: now + rule.windowMs });
        continue;
      }

      window.count += 1;
      if (window.count > rule.limit) {
        const retryAfter = Math.ceil((window.resetAt - now) / 1000);
        throw new HttpException(
          `${rule.message} Réessayez dans ${retryAfter > 60 ? `${Math.ceil(retryAfter / 60)} minutes` : `${retryAfter} secondes`}.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }

  /** Purge périodique : sans elle, la table grossit indéfiniment. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
