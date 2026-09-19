import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { MikrotikError } from '@wifitati/mikrotik-service';

/** Ce que la console doit pouvoir distinguer pour orienter un dépannage. */
export type RouterReachability =
  /** Le dernier appel a abouti. */
  | 'JOIGNABLE'
  /** Le routeur ne répond pas : lien coupé, tunnel tombé, machine éteinte. */
  | 'INJOIGNABLE'
  /** Le routeur répond mais refuse ou échoue : identifiants, service REST. */
  | 'REPOND_MAL'
  /** Aucun appel depuis le démarrage. */
  | 'INCONNU';

export interface RouterHealth {
  routerId: string;
  state: RouterReachability;
  /** Échecs réseau consécutifs. Remis à zéro au premier succès. */
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  /** Tant que cette date n'est pas passée, les appels échouent aussitôt. */
  openUntil: Date | null;
}

/** Levée sans toucher au réseau quand le disjoncteur est ouvert. */
export class RouterUnreachableException extends ServiceUnavailableException {
  constructor(routerLabel: string, detail: string) {
    super(`Routeur « ${routerLabel} » injoignable — ${detail}`);
  }
}

/** Trois échecs réseau d'affilée suffisent à conclure : ce n'est pas un aléa. */
const FAILURE_THRESHOLD = 3;
/** Repos avant de retenter. Assez court pour qu'un retour de lien se voie vite. */
const COOLDOWN_MS = 30_000;

/**
 * Disjoncteur par routeur.
 *
 * Sans lui, un routeur mort coûte le budget complet à **chaque** appel :
 * 5 secondes de délai, trois tentatives, plus le backoff — environ seize
 * secondes. Un écran qui interroge le routeur trois fois en parallèle met
 * donc près d'une minute à afficher une erreur, et l'utilisateur conclut que
 * la console est cassée alors que c'est son lien qui est tombé.
 *
 * Après trois échecs réseau consécutifs, les appels suivants échouent
 * immédiatement pendant trente secondes, puis un appel est laissé passer pour
 * sonder le retour. Un succès referme le disjoncteur.
 *
 * Seules les erreurs de **réseau** l'ouvrent. Un mot de passe refusé ou un
 * conflit métier n'ont rien à voir avec la joignabilité : les confondre
 * couperait l'accès à un routeur parfaitement joignable dont on aurait mal
 * saisi les identifiants — et masquerait la vraie cause.
 */
@Injectable()
export class RouterHealthService {
  private readonly logger = new Logger(RouterHealthService.name);
  private readonly health = new Map<string, RouterHealth>();

  get(routerId: string): RouterHealth {
    const existing = this.health.get(routerId);
    if (existing) return existing;

    const fresh: RouterHealth = {
      routerId,
      state: 'INCONNU',
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      openUntil: null,
    };
    this.health.set(routerId, fresh);
    return fresh;
  }

  all(): RouterHealth[] {
    return [...this.health.values()];
  }

  /** `null` si l'appel peut partir ; sinon la raison du refus immédiat. */
  blockedReason(routerId: string): string | null {
    const health = this.health.get(routerId);
    if (!health?.openUntil) return null;

    if (health.openUntil.getTime() <= Date.now()) {
      // Fin du repos : on laisse passer un appel pour sonder le retour du
      // lien. S'il échoue, `recordFailure` rouvre pour un nouveau cycle.
      health.openUntil = null;
      return null;
    }

    const seconds = Math.ceil((health.openUntil.getTime() - Date.now()) / 1000);
    return `${health.lastErrorMessage ?? 'pas de réponse'} (nouvelle tentative dans ${seconds} s)`;
  }

  recordSuccess(routerId: string): void {
    const health = this.get(routerId);
    if (health.state !== 'JOIGNABLE') {
      this.logger.log(`Routeur ${routerId} de nouveau joignable`);
    }
    health.state = 'JOIGNABLE';
    health.consecutiveFailures = 0;
    health.lastSuccessAt = new Date();
    health.lastErrorCode = null;
    health.lastErrorMessage = null;
    health.openUntil = null;
  }

  recordFailure(routerId: string, error: unknown): void {
    const health = this.get(routerId);
    health.lastFailureAt = new Date();
    health.lastErrorCode = error instanceof MikrotikError ? error.code : 'UNKNOWN';
    health.lastErrorMessage = (error as Error)?.message ?? String(error);

    if (!isNetworkFailure(error)) {
      // Le routeur a répondu : il est joignable, c'est l'opération qui a
      // échoué. Le disjoncteur ne bouge pas.
      health.state = 'REPOND_MAL';
      return;
    }

    health.state = 'INJOIGNABLE';
    health.consecutiveFailures += 1;

    if (health.consecutiveFailures >= FAILURE_THRESHOLD) {
      health.openUntil = new Date(Date.now() + COOLDOWN_MS);
      this.logger.warn(
        `Routeur ${routerId} déclaré injoignable après ${health.consecutiveFailures} échecs : appels suspendus ${COOLDOWN_MS / 1000} s`,
      );
    }
  }

  /** Remet un routeur à l'état neuf — après modification de ses paramètres. */
  reset(routerId: string): void {
    this.health.delete(routerId);
  }
}

/**
 * Une panne de lien, par opposition à un refus du routeur. Les erreurs de
 * validation et de conflit sont produites **avant** tout appel réseau : les
 * compter comme des pannes ouvrirait le disjoncteur sur une faute de saisie.
 */
function isNetworkFailure(error: unknown): boolean {
  if (error instanceof MikrotikError) {
    return error.code === 'CONNECTION_ERROR' || error.code === 'TIMEOUT';
  }
  // Une erreur non typée vient d'en dessous de la couche MikroTik : elle est
  // traitée comme un problème de transport.
  return true;
}
