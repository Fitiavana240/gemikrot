import { ForbiddenException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContextService } from '../tenancy/tenant-context.service.js';

/**
 * Modèles portant un `tenantId`, donc cloisonnés. La liste est explicite :
 * un modèle oublié resterait visible de tous, mieux vaut le déclarer que le
 * déduire.
 */
const TENANT_SCOPED_MODELS = new Set<string>([
  'Router',
  'Plan',
  'Customer',
  'Subscription',
  'Device',
  'VoucherBatch',
  'Voucher',
  'Payment',
  'MobileMoneyAccount',
  'TicketTemplate',
  'PaymentClaim',
  'RouterOperation',
]);

/** Opérations dont le `where` doit être restreint à l'exploitant courant. */
const FILTERED_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** Un client étendu par exploitant, construit à la demande puis réutilisé. */
  private readonly clientsByTenant = new Map<string, PrismaClient>();

  constructor(private readonly tenantContext: TenantContextService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Client cloisonné : à utiliser par **tous** les services métier. Le
   * `tenantId` courant est injecté dans chaque requête, si bien qu'un filtre
   * oublié dans un service ne peut pas exposer les données d'un autre
   * exploitant.
   *
   * L'exploitant est résolu **ici**, au moment de l'accès, et non dans le
   * callback de l'extension : le contexte `AsyncLocalStorage` ne survit pas
   * au passage dans le moteur Prisma, ce qui ferait silencieusement sauter
   * tout le cloisonnement.
   *
   * Le client brut (`this`) reste accessible pour ce qui est transverse par
   * nature : authentification, gestion des exploitants, seed.
   */
  get scoped(): PrismaClient {
    const context = this.tenantContext.get();
    const withoutScope = !context?.tenantId || context.isSuperAdmin;
    // Toujours un client étendu, jamais `this` : le constructeur de Prisma
    // renvoie un proxy, et `this` vu de l'intérieur de la classe n'expose pas
    // les modèles.
    return this.clientForTenant(withoutScope ? null : context!.tenantId!);
  }

  /**
   * Même client que `scoped`, mais qui **refuse** de travailler sans
   * exploitant au lieu de retomber sur un client non cloisonné.
   *
   * `scoped` dégrade en silence : hors requête HTTP (tâche de fond) ou sur un
   * point d'entrée public (pas de JWT), le contexte est vide et l'extension
   * laisse passer les requêtes telles quelles — un `updateMany` toucherait
   * alors les lignes de tous les exploitants, sans erreur ni trace. Ce
   * comportement est conservé pour le code existant, qui s'exécute toujours
   * dans une requête authentifiée.
   *
   * Tout code s'exécutant hors de ce cadre — worker, webhook, page publique —
   * utilise `scopedStrict` et se place explicitement sur un exploitant avec
   * `TenantContextService.runAsTenant`.
   */
  get scopedStrict(): PrismaClient {
    const context = this.tenantContext.get();
    if (context?.isSuperAdmin) return this.clientForTenant(null);
    if (!context?.tenantId) {
      throw new ForbiddenException(
        "Accès aux données sans exploitant : encadrer l'appel par runAsTenant()",
      );
    }
    return this.clientForTenant(context.tenantId);
  }

  private clientForTenant(tenantId: string | null): PrismaClient {
    const key = tenantId ?? '__sans_cloisonnement__';
    const cached = this.clientsByTenant.get(key);
    if (cached) return cached;

    const client = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (tenantId === null || !TENANT_SCOPED_MODELS.has(model)) {
              return query(args);
            }

            const next = args as Record<string, unknown>;

            if (FILTERED_OPERATIONS.has(operation)) {
              next.where = { ...((next.where as object) ?? {}), tenantId };
            } else if (operation === 'create') {
              next.data = { ...((next.data as object) ?? {}), tenantId };
            } else if (operation === 'createMany') {
              const data = next.data;
              next.data = Array.isArray(data)
                ? data.map((row) => ({ ...(row as object), tenantId }))
                : { ...((data as object) ?? {}), tenantId };
            } else if (operation === 'upsert') {
              next.where = { ...((next.where as object) ?? {}), tenantId };
              next.create = { ...((next.create as object) ?? {}), tenantId };
            }

            return query(next);
          },
        },
      },
    }) as unknown as PrismaClient;

    this.clientsByTenant.set(key, client);
    return client;
  }
}
