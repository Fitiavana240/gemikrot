/**
 * Hiérarchie d'erreurs dédiée à la couche MikroTik.
 * Le reste de l'application (contrôleurs, services métier, frontend via
 * l'API HTTP) ne doit jamais connaître les codes d'erreur bruts de
 * RouterOS : il manipule uniquement ces classes typées.
 */

export type MikrotikErrorCode =
  | 'CONNECTION_ERROR'
  | 'TIMEOUT'
  | 'AUTH_ERROR'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'API_ERROR'
  | 'UNKNOWN';

export interface MikrotikErrorDetails {
  [key: string]: unknown;
}

export abstract class MikrotikError extends Error {
  public readonly code: MikrotikErrorCode;
  public readonly details?: MikrotikErrorDetails;
  /** Indique si la couche retry peut légitimement rejouer l'opération. */
  public readonly retryable: boolean;
  public readonly cause?: Error;

  protected constructor(params: {
    code: MikrotikErrorCode;
    message: string;
    retryable: boolean;
    details?: MikrotikErrorDetails;
    cause?: Error;
  }) {
    super(params.message);
    this.name = new.target.name;
    this.code = params.code;
    this.retryable = params.retryable;
    this.details = params.details;
    this.cause = params.cause;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Le routeur est injoignable (réseau, DNS, TLS handshake, etc.). */
export class MikrotikConnectionError extends MikrotikError {
  constructor(message: string, cause?: Error) {
    super({ code: 'CONNECTION_ERROR', message, retryable: true, cause });
  }
}

/** La requête a dépassé le délai imparti. */
export class MikrotikTimeoutError extends MikrotikError {
  constructor(message: string, details?: MikrotikErrorDetails) {
    super({ code: 'TIMEOUT', message, retryable: true, details });
  }
}

/** Identifiants invalides ou compte de service désactivé sur RouterOS. */
export class MikrotikAuthError extends MikrotikError {
  constructor(message = 'Authentification RouterOS refusée') {
    super({ code: 'AUTH_ERROR', message, retryable: false });
  }
}

/** Entité absente côté RouterOS (utilisateur, profil, session, ...). */
export class MikrotikNotFoundError extends MikrotikError {
  constructor(entity: string, identifier: string) {
    super({
      code: 'NOT_FOUND',
      message: `${entity} introuvable : ${identifier}`,
      retryable: false,
      details: { entity, identifier },
    });
  }
}

/** Entrée fournie à la couche MikroTik invalide (avant tout appel réseau). */
export class MikrotikValidationError extends MikrotikError {
  constructor(message: string, details?: MikrotikErrorDetails) {
    super({ code: 'VALIDATION_ERROR', message, retryable: false, details });
  }
}

/** Conflit métier (ex : utilisateur déjà existant). */
export class MikrotikConflictError extends MikrotikError {
  constructor(message: string, details?: MikrotikErrorDetails) {
    super({ code: 'CONFLICT', message, retryable: false, details });
  }
}

/** Erreur retournée par RouterOS lui-même (4xx/5xx non catégorisé ci-dessus). */
export class MikrotikApiError extends MikrotikError {
  constructor(message: string, details?: MikrotikErrorDetails) {
    super({ code: 'API_ERROR', message, retryable: false, details });
  }
}

export function isRetryableError(error: unknown): boolean {
  return error instanceof MikrotikError ? error.retryable : false;
}
