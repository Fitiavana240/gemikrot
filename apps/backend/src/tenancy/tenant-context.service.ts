import { ForbiddenException, Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  /** `null` pour un SUPER_ADMIN, qui n'est rattaché à aucun exploitant. */
  tenantId: string | null;
  /** Vrai uniquement pour le SUPER_ADMIN : contourne le cloisonnement. */
  isSuperAdmin: boolean;
  /**
   * Vrai quand un SUPER_ADMIN agit **au nom** d'un exploitant.
   *
   * Distinct de `isSuperAdmin`, qui est justement abandonné dans ce cas : le
   * contexte devient indiscernable de celui de l'exploitant, et c'est voulu
   * pour le cloisonnement. Mais le journal, lui, doit pouvoir dire qui a
   * réellement agi — « l'exploitant a supprimé ce compte » et « l'éditeur
   * l'a supprimé pour lui » ne se relisent pas de la même façon.
   */
  priseEnMain?: boolean;
}

/**
 * Porte l'exploitant courant sur toute la durée d'une requête, sans avoir à
 * le faire transiter en paramètre dans chaque service. Alimenté par
 * `TenantContextInterceptor` à partir du JWT, et lu par l'extension Prisma
 * qui applique le cloisonnement.
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run<T>(context: TenantContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): TenantContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Exploitant courant, exigé lors d'une création. Échoue plutôt que de
   * laisser créer une ligne orpheline — cas du SUPER_ADMIN qui agirait sans
   * s'être placé sur un exploitant (voir `runAsTenant`).
   */
  requireTenantId(): string {
    const tenantId = this.get()?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException(
        "Aucun exploitant dans le contexte : le SUPER_ADMIN doit cibler un exploitant pour cette action",
      );
    }
    return tenantId;
  }

  /**
   * Exécute un traitement hors requête HTTP (seed, import en tâche de fond)
   * en se plaçant explicitement sur un exploitant.
   */
  runAsTenant<T>(tenantId: string, callback: () => T): T {
    return this.run({ tenantId, isSuperAdmin: false }, callback);
  }
}
