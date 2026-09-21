import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContextService } from './tenant-context.service.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';

/**
 * L'exploitant qu'un SUPER_ADMIN a choisi de piloter, porté par la requête.
 *
 * Un en-tête plutôt qu'un paramètre : il vaut pour toutes les routes, y
 * compris celles dont le corps n'a pas de place pour lui.
 */
const EN_TETE_EXPLOITANT = 'x-tenant-id';

/**
 * Place chaque requête dans le contexte de l'exploitant de l'utilisateur
 * connecté, pour que l'accès aux données soit cloisonné sans que les
 * services aient à s'en préoccuper.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const requête = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = requête.user;
    const estSuperAdmin = user?.role === 'SUPER_ADMIN';

    // Un SUPER_ADMIN n'appartient à aucun exploitant : tant qu'il n'en cible
    // aucun, toute action qui crée une ligne échoue, puisqu'elle ne saurait
    // à qui la rattacher. C'est le sens du message de `requireTenantId`.
    //
    // Quand il en cible un, il agit **comme** cet exploitant : le
    // contournement est abandonné (`isSuperAdmin: false`). Le garder
    // donnerait des lectures sur tout le parc et des écritures sur un seul
    // exploitant — `PrismaService.scoped` ignore le cloisonnement dès que le
    // drapeau est levé. C'est exactement ce que fait `runAsTenant`, et pour
    // la même raison.
    //
    // L'en-tête n'est lu que pour un SUPER_ADMIN : pour tout autre compte,
    // le jeton fait foi et un en-tête forgé n'a aucun effet.
    const ciblé = estSuperAdmin ? entêteSimple(requête.headers?.[EN_TETE_EXPLOITANT]) : null;

    return this.tenantContext.run(
      ciblé
        ? // `priseEnMain` survit là où `isSuperAdmin` est abandonné : le
          // cloisonnement doit ignorer qui agit, le journal non.
          { tenantId: ciblé, isSuperAdmin: false, priseEnMain: true }
        : { tenantId: user?.tenantId ?? null, isSuperAdmin: estSuperAdmin },
      () => next.handle(),
    );
  }
}

/** Node rend un tableau quand un en-tête est répété ; on n'en garde rien. */
function entêteSimple(valeur: string | string[] | undefined): string | null {
  if (typeof valeur !== 'string') return null;
  const propre = valeur.trim();
  return propre === '' ? null : propre;
}
