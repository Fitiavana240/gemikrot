import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RouterOperation, RouterOperationStatus } from '@prisma/client';
import type { IMikrotikService } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';
import { RouterAccessService } from './router-access.service.js';
import { RouterHealthService, RouterUnreachableException } from './router-health.service.js';

/**
 * Opérations qu'on accepte de différer.
 *
 * Toutes doivent être **rejouables sans dommage** : la file garantit au moins
 * une exécution, jamais exactement une. Couper un accès déjà coupé, désactiver
 * un compte déjà désactivé, resynchroniser une offre déjà synchronisée : aucun
 * effet de bord. Une opération qui ne tolérerait pas d'être rejouée — créer un
 * compte, encaisser — n'a rien à faire ici.
 */
export const ROUTER_OPERATIONS = {
  /** Couper réellement un accès : compte désactivé, cookies purgés, session fermée. */
  COUPER_ACCES: 'COUPER_ACCES',
  /** Suspendre ou réactiver un compte User Manager. */
  BASCULER_COMPTE: 'BASCULER_COMPTE',
} as const;

export type RouterOperationKind = (typeof ROUTER_OPERATIONS)[keyof typeof ROUTER_OPERATIONS];

interface CouperAccesPayload {
  username: string;
}
interface BasculerComptePayload {
  username: string;
  disabled: boolean;
}

/** Au-delà, on cesse de réessayer : l'opération n'est plus un incident de lien. */
const MAX_ATTEMPTS = 10;

/**
 * File des écritures vers le routeur qui n'ont pas pu partir.
 *
 * Elle existe pour un cas précis, et coûteux : un ticket expire pendant que le
 * lien est coupé. Sans file, la coupure d'accès est simplement perdue — le
 * client continue de naviguer avec un ticket périmé, et plus personne ne
 * repassera jamais. Avec elle, l'ordre est conservé et rejoué dès que le
 * routeur redevient joignable.
 *
 * Le déclencheur est le disjoncteur : quand il constate le retour d'un
 * routeur, il prévient cette file. Aucune tâche planifiée n'est nécessaire
 * pour le cas nominal — un routeur qui revient est un routeur qu'on rappelle.
 */
@Injectable()
export class RouterOperationQueue implements OnModuleInit {
  private readonly logger = new Logger(RouterOperationQueue.name);
  /** Un routeur à la fois : deux vidanges concurrentes rejoueraient tout en double. */
  private readonly draining = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: MikrotikClientFactory,
    private readonly access: RouterAccessService,
    private readonly health: RouterHealthService,
    private readonly tenantContext: TenantContextService,
  ) {}

  onModuleInit(): void {
    this.health.onRecovered((routerId) => {
      // Sans `await` : on ne retarde pas l'appel qui vient de réussir, et une
      // vidange en échec ne doit pas le faire échouer.
      void this.drain(routerId).catch((error) =>
        this.logger.error(`Vidange du routeur ${routerId} en échec : ${String(error)}`),
      );
    });

    // Et au démarrage, sans attendre de reconnexion.
    //
    // L'état de santé vit en mémoire : après un redémarrage, tout routeur
    // repart d'`INCONNU`, si bien que le premier appel réussi ne compte pas
    // comme un retour — `wasDown` teste `INJOIGNABLE`. Sans ce rattrapage, ce
    // qui avait été mis en file avant l'arrêt y restait jusqu'à ce que le
    // routeur retombe puis revienne. Or les deux se produisent ensemble : à
    // Toliara, une coupure de courant emporte le serveur et le routeur.
    void this.vidangeAuDemarrage();
  }

  /**
   * Reprend les files laissées par le processus précédent.
   *
   * Détachée : le démarrage de l'application n'attend pas un routeur qui
   * peut être encore éteint. `drain` s'arrête de lui-même dès le premier
   * échec si le lien est mort, donc au pire un essai par routeur.
   */
  private async vidangeAuDemarrage(): Promise<void> {
    try {
      // Client brut : aucun exploitant n'est encore posé, et il s'agit
      // justement de reprendre les files de tous.
      // Hors cloisonnement : aucun exploitant n'est encore posé au démarrage,
      // et il s'agit justement de reprendre les files de tous.
      const enAttente = await this.prisma.routerOperation.groupBy({
        by: ['routerId'],
        where: { status: RouterOperationStatus.EN_ATTENTE },
      });
      if (enAttente.length === 0) return;

      this.logger.log(
        `Reprise au démarrage : ${enAttente.length} routeur(s) avec des opérations en attente`,
      );
      for (const { routerId } of enAttente) {
        await this.drain(routerId).catch((error) =>
          this.logger.error(`Reprise du routeur ${routerId} en échec : ${String(error)}`),
        );
      }
    } catch (error) {
      // Une reprise impossible ne doit pas empêcher l'application de démarrer.
      this.logger.error(`Reprise au démarrage en échec : ${String(error)}`);
    }
  }

  /**
   * Met une opération en attente. L'appelant doit déjà être placé sur un
   * exploitant : la file est cloisonnée comme le reste.
   */
  async enqueue(
    routerId: string,
    kind: RouterOperationKind,
    payload: Record<string, unknown>,
    reason: string,
  ): Promise<RouterOperation> {
    const tenantId = this.tenantContext.requireTenantId();

    // Une même opération déjà en attente n'a pas à être doublée : elle sera
    // rejouée de toute façon, et deux lignes donneraient deux exécutions.
    const existing = await this.prisma.scopedStrict.routerOperation.findFirst({
      where: {
        routerId,
        kind,
        status: RouterOperationStatus.EN_ATTENTE,
        payload: { equals: payload as never },
      },
    });
    if (existing) return existing;

    const operation = await this.prisma.scopedStrict.routerOperation.create({
      data: { tenantId, routerId, kind, payload: payload as never, reason },
    });
    this.logger.log(`Opération différée : ${kind} sur ${routerId} — ${reason}`);
    return operation;
  }

  /** Ce qui attend, pour que l'exploitant sache que rien n'est perdu. */
  pending(routerId?: string): Promise<RouterOperation[]> {
    return this.prisma.scopedStrict.routerOperation.findMany({
      where: { status: RouterOperationStatus.EN_ATTENTE, ...(routerId ? { routerId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Rejoue ce qui attend pour un routeur.
   *
   * Appelée hors requête HTTP lorsqu'elle vient du signal de reconnexion :
   * l'exploitant est donc relu depuis l'opération elle-même et posé
   * explicitement, sinon l'accès aux données refuserait de travailler.
   */
  async drain(routerId: string): Promise<{ done: number; failed: number; abandoned: number }> {
    if (this.draining.has(routerId)) {
      return { done: 0, failed: 0, abandoned: 0 };
    }
    this.draining.add(routerId);

    try {
      // Client brut : cette lecture précède la résolution de l'exploitant,
      // c'est elle qui la détermine. Restreinte à un routeur donné.
      // Hors cloisonnement : cette lecture précède la résolution de
      // l'exploitant, c'est elle qui la détermine. Restreinte à un routeur.
      const waiting = await this.prisma.routerOperation.findMany({
        where: { routerId, status: RouterOperationStatus.EN_ATTENTE },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      if (waiting.length === 0) return { done: 0, failed: 0, abandoned: 0 };

      this.logger.log(`Vidange de ${waiting.length} opération(s) sur ${routerId}`);
      let done = 0;
      let failed = 0;
      let abandoned = 0;

      for (const operation of waiting) {
        const outcome = await this.tenantContext.runAsTenant(operation.tenantId, () =>
          this.replay(operation),
        );
        if (outcome === 'done') done += 1;
        else if (outcome === 'abandoned') abandoned += 1;
        else {
          failed += 1;
          // Le routeur est retombé : inutile d'épuiser la file contre un lien
          // mort, le prochain retour la reprendra où elle en est.
          if (this.health.blockedReason(routerId)) break;
        }
      }

      return { done, failed, abandoned };
    } finally {
      this.draining.delete(routerId);
    }
  }

  private async replay(operation: RouterOperation): Promise<'done' | 'failed' | 'abandoned'> {
    try {
      const mikrotik = await this.clients.forRouter(operation.routerId);
      await this.execute(mikrotik, operation);

      await this.prisma.scopedStrict.routerOperation.update({
        where: { id: operation.id },
        data: {
          status: RouterOperationStatus.TERMINEE,
          attempts: operation.attempts + 1,
          completedAt: new Date(),
          lastError: null,
        },
      });
      return 'done';
    } catch (error) {
      const attempts = operation.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;

      await this.prisma.scopedStrict.routerOperation.update({
        where: { id: operation.id },
        data: {
          attempts,
          lastError: (error as Error)?.message?.slice(0, 500) ?? String(error),
          // Abandonner en silence serait pire que ne rien faire : l'état est
          // conservé, visible, et motivé.
          ...(giveUp ? { status: RouterOperationStatus.ABANDONNEE, completedAt: new Date() } : {}),
        },
      });

      if (giveUp) {
        this.logger.error(
          `Opération ${operation.kind} abandonnée après ${attempts} tentatives sur ${operation.routerId}`,
        );
        return 'abandoned';
      }
      return 'failed';
    }
  }

  private async execute(mikrotik: IMikrotikService, operation: RouterOperation): Promise<void> {
    const payload = operation.payload as Record<string, unknown>;

    switch (operation.kind) {
      case ROUTER_OPERATIONS.COUPER_ACCES: {
        const { username } = payload as unknown as CouperAccesPayload;
        // Le même code que la coupure immédiate, et non une copie : le trou
        // des cookies a déjà été bouché une fois, il ne doit pas se rouvrir
        // ici parce qu'une seule des deux versions aurait été corrigée.
        // Le compte reste en place, seul l'accès tombe : rejouable sans dommage.
        await this.access.revoke(mikrotik, username, { disableAccount: true });
        return;
      }

      case ROUTER_OPERATIONS.BASCULER_COMPTE: {
        const { username, disabled } = payload as unknown as BasculerComptePayload;
        await mikrotik.setUserManagerUserDisabled(username, disabled);
        return;
      }

      default:
        // Une opération d'une version antérieure du code, ou mal écrite : on
        // l'abandonne plutôt que de la rejouer indéfiniment.
        throw new Error(`Opération inconnue : ${operation.kind}`);
    }
  }
}

/** Vrai quand l'échec vient de l'injoignabilité, pas de l'opération elle-même. */
export function isUnreachable(error: unknown): boolean {
  return error instanceof RouterUnreachableException;
}
