import { ILogger, LogContext } from './logger.interface';

const SENSITIVE_KEY_FRAGMENTS = ['password', 'secret', 'token', 'authorization'];

function redact(context?: LogContext): LogContext | undefined {
  if (!context) return context;
  const clone: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    const isSensitive = SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
      key.toLowerCase().includes(fragment),
    );
    clone[key] = isSensitive ? '***redacted***' : value;
  }
  return clone;
}

/**
 * Implémentation par défaut, adaptée au développement local.
 * En production, remplacer par un adaptateur vers l'outil d'observabilité
 * de l'application hôte tout en conservant le même contrat `ILogger`.
 */
export class ConsoleLogger implements ILogger {
  constructor(private readonly scope: string) {}

  private write(level: string, message: string, context?: LogContext): void {
    const payload = {
      level,
      scope: this.scope,
      message,
      timestamp: new Date().toISOString(),
      ...redact(context),
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }
}
