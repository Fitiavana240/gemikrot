const TOKEN_KEY = 'wifitati_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Passe par le proxy Vite `/api` (voir vite.config.ts) en dev pour éviter le
 * CORS ; en production le frontend est servi derrière le même reverse proxy
 * que le backend (Section 35 : le navigateur ne parle jamais directement à
 * RouterOS, seulement au backend).
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`/api${path}`, { ...options, headers });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : undefined;

  // Un 401 sur une session ouverte veut dire jeton expiré : on renvoie vers
  // la connexion. Un 401 sans jeton est une tentative de connexion refusée,
  // et rediriger reviendrait à recharger l'écran de connexion — effaçant au
  // passage le message d'erreur que l'appelant s'apprête à afficher.
  if (res.status === 401) {
    if (token) {
      clearToken();
      window.location.assign('/login');
      throw new ApiError(401, 'Session expirée');
    }
    throw new ApiError(401, body?.message ?? 'Identifiants invalides');
  }

  if (!res.ok) {
    throw new ApiError(res.status, body?.message ?? `Erreur ${res.status}`);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
