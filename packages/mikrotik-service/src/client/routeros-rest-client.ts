import { RouterOSClientConfig, DEFAULT_CLIENT_OPTIONS } from '../config/mikrotik-client.config';
import { ILogger } from '../logging/logger.interface';
import {
  MikrotikApiError,
  MikrotikAuthError,
  MikrotikConnectionError,
  MikrotikNotFoundError,
  MikrotikTimeoutError,
} from '../errors/mikrotik.errors';
import { withControlledRetry } from './retry';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';

type ResolvedConfig = Required<Omit<RouterOSClientConfig, 'tlsFingerprint'>> &
  Pick<RouterOSClientConfig, 'tlsFingerprint'>;

/**
 * Client HTTP bas niveau pour l'API REST RouterOS (`/rest/...`).
 *
 * Il ne connaît AUCUNE règle métier : il sait uniquement parler HTTP à
 * RouterOS, gérer le timeout, le retry contrôlé, l'authentification et le
 * logging technique. Toute la sémantique métier (mapping DTO, validation,
 * vérifications d'existence, etc.) vit exclusivement dans
 * `RouterOSMikrotikService`.
 *
 * Aucune autre couche de l'application ne doit importer cette classe
 * directement — elle transite uniquement via `IMikrotikService`.
 */
export class RouterOSRestClient {
  private readonly config: ResolvedConfig;

  constructor(config: RouterOSClientConfig, private readonly logger: ILogger) {
    this.config = { ...DEFAULT_CLIENT_OPTIONS, ...config } as ResolvedConfig;
  }

  async get<T>(path: string, query?: Record<string, string | number | boolean>): Promise<T> {
    return this.execute<T>('GET', path, undefined, query);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.execute<T>('POST', path, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.execute<T>('PATCH', path, body);
  }

  async delete<T = void>(path: string): Promise<T> {
    return this.execute<T>('DELETE', path);
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean>): string {
    const url = new URL(`/rest${path}`, this.config.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async execute<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean>,
  ): Promise<T> {
    return withControlledRetry(() => this.rawRequest<T>(method, path, body, query), {
      maxRetries: this.config.maxRetries,
      baseDelayMs: this.config.retryDelayMs,
      logger: this.logger,
      operationName: `${method} ${path}`,
    });
  }

  private async rawRequest<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean>,
  ): Promise<T> {
    const url = this.buildUrl(path, query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    const startedAt = Date.now();

    // Le body n'est JAMAIS loggué : il peut contenir un mot de passe en clair
    // (création d'utilisateur User Manager notamment).
    this.logger.debug('Appel RouterOS', { method, path });

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const durationMs = Date.now() - startedAt;

      if (response.status === 401 || response.status === 403) {
        this.logger.error('Authentification RouterOS refusée', { method, path, status: response.status });
        throw new MikrotikAuthError();
      }

      if (response.status === 404) {
        throw new MikrotikNotFoundError('ressource RouterOS', path);
      }

      if (!response.ok) {
        const errorBody = await this.safeParseJson(response);
        this.logger.error('Erreur RouterOS', {
          method,
          path,
          status: response.status,
          durationMs,
          routerosMessage: errorBody?.message ?? errorBody?.detail,
        });
        throw new MikrotikApiError(`RouterOS a répondu ${response.status} pour ${method} ${path}`, {
          status: response.status,
          body: errorBody,
        });
      }

      this.logger.debug('Réponse RouterOS OK', { method, path, status: response.status, durationMs });

      if (response.status === 204) {
        return undefined as unknown as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (
        error instanceof MikrotikApiError ||
        error instanceof MikrotikAuthError ||
        error instanceof MikrotikNotFoundError
      ) {
        throw error;
      }

      if ((error as Error)?.name === 'AbortError') {
        throw new MikrotikTimeoutError(`Timeout après ${this.config.timeoutMs}ms pour ${method} ${path}`);
      }

      throw new MikrotikConnectionError(`Connexion à RouterOS impossible pour ${method} ${path}`, error as Error);
    } finally {
      clearTimeout(timer);
    }
  }

  private async safeParseJson(response: Response): Promise<any> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
}
