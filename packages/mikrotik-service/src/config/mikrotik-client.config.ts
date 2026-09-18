/**
 * Configuration de connexion au MikroTik. Ne doit jamais être codée en dur :
 * elle provient d'un coffre-fort de secrets / variables d'environnement.
 */
export interface RouterOSClientConfig {
  /** Ex: https://192.168.88.1 (TLS obligatoire hors environnement de lab) */
  baseUrl: string;
  username: string;
  password: string;
  /** Timeout par requête HTTP, en millisecondes. Défaut : 5000. */
  timeoutMs?: number;
  /** Nombre de nouvelles tentatives après le premier échec. Défaut : 2. */
  maxRetries?: number;
  /** Délai de base (ms) du backoff exponentiel. Défaut : 300. */
  retryDelayMs?: number;
  /** false uniquement en lab avec certificat auto-signé non épinglé. */
  rejectUnauthorized?: boolean;
  /** Empreinte du certificat TLS à épingler (recommandé en production). */
  tlsFingerprint?: string;
}

export const DEFAULT_CLIENT_OPTIONS = {
  timeoutMs: 5000,
  maxRetries: 2,
  retryDelayMs: 300,
  rejectUnauthorized: true,
} as const;
