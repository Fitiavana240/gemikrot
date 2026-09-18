export interface LogContext {
  [key: string]: unknown;
}

/**
 * Abstraction de logging : la couche MikroTik ne dépend d'aucun framework
 * de logs particulier. Le backend hôte (NestJS, Fastify, ...) fournit sa
 * propre implémentation (ex : wrapper autour de pino/winston).
 */
export interface ILogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
