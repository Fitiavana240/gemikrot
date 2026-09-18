import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContextService } from './tenant-context.service.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';

/**
 * Place chaque requête dans le contexte de l'exploitant de l'utilisateur
 * connecté, pour que l'accès aux données soit cloisonné sans que les
 * services aient à s'en préoccuper.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user: AuthenticatedUser | undefined = context.switchToHttp().getRequest().user;

    return this.tenantContext.run(
      {
        tenantId: user?.tenantId ?? null,
        isSuperAdmin: user?.role === 'SUPER_ADMIN',
      },
      () => next.handle(),
    );
  }
}
