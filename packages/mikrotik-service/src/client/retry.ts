import { ILogger } from '../logging/logger.interface';
import { isRetryableError } from '../errors/mikrotik.errors';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  logger: ILogger;
  operationName: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exécute `fn` avec une stratégie de retry contrôlée :
 * - seules les erreurs marquées `retryable` (timeout, erreur de connexion)
 *   sont rejouées — jamais une erreur d'authentification, de validation
 *   ou un conflit métier ;
 * - backoff exponentiel avec un peu de jitter pour éviter les retries
 *   synchronisés en cas de panne collective ;
 * - nombre de tentatives strictement borné par `maxRetries`.
 */
export async function withControlledRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs, logger, operationName } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);

      if (!retryable || attempt === maxRetries) {
        logger.error(`${operationName} : échec définitif`, {
          attempt,
          retryable,
          error: (error as Error)?.message,
        });
        throw error;
      }

      const backoffMs = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 100);
      logger.warn(`${operationName} : échec, nouvelle tentative programmée`, {
        attempt: attempt + 1,
        maxRetries,
        backoffMs,
        error: (error as Error)?.message,
      });
      await delay(backoffMs);
    }
  }

  // Inatteignable en pratique (la boucle jette toujours avant), mais requis par TS.
  throw lastError;
}
