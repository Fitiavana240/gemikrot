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

const TENANT_KEY = 'wifitati_tenant_cible';

/**
 * L'exploitant qu'un SUPER_ADMIN pilote.
 *
 * Il n'appartient à aucun exploitant : sans en cibler un, toute action qui
 * crée une ligne échoue, faute de savoir à qui la rattacher. Le choix est
 * retenu d'une visite à l'autre — le changer à chaque connexion serait une
 * corvée pour quelqu'un qui n'en gère qu'un.
 *
 * Sans effet pour les autres comptes : leur jeton porte déjà leur exploitant,
 * et le serveur ignore cet en-tête pour eux.
 */
export function getTenantCible(): string | null {
  try {
    return localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}

export function setTenantCible(tenantId: string | null): void {
  try {
    if (tenantId) localStorage.setItem(TENANT_KEY, tenantId);
    else localStorage.removeItem(TENANT_KEY);
  } catch {
    // Navigation privée ou stockage refusé : la console marche quand même,
    // elle oublie simplement le choix au rechargement.
  }
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

  // Envoyé sans condition de rôle : le serveur ne le lit que pour un
  // SUPER_ADMIN. Le filtrer ici demanderait de connaître le rôle dans une
  // couche qui n'a que le jeton, et un en-tête ignoré ne coûte rien.
  const tenantCible = getTenantCible();
  if (tenantCible) headers.set('X-Tenant-Id', tenantCible);

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
