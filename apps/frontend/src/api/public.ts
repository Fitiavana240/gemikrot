/**
 * Client des routes publiques. Volontairement **séparé** de `api/client.ts` :
 * celui-ci attache le jeton de l'admin s'il y en a un en mémoire, et il n'y a
 * aucune raison d'envoyer le jeton d'une console ouverte sur une page que
 * n'importe qui consulte.
 */

export interface PublicPlan {
  id: string;
  name: string;
  description: string | null;
  price: string;
  validityDurationSeconds: number;
  maxSharedUsers: number | null;
}

export interface PublicPaymentAccount {
  id: string;
  provider: string;
  phoneNumber: string;
  accountName: string;
}

export interface PublicTenant {
  wifiName: string;
  logoUrl: string | null;
  currency: string;
  plans: PublicPlan[];
  paymentAccounts: PublicPaymentAccount[];
}

export type ClaimState = 'EN_ATTENTE' | 'VALIDE' | 'REFUSE';

export interface ClaimView {
  state: ClaimState;
  accessCode: string | null;
  planName: string;
  amount: string;
  currency: string;
  createdAt: string;
}

export class PublicApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/public${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : undefined;

  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new PublicApiError(response.status, message ?? `Erreur ${response.status}`);
  }
  return body as T;
}

export const publicApi = {
  tenant: (slug: string) => request<PublicTenant>(`/${slug}`),
  claim: (
    slug: string,
    input: { planId: string; accountId: string; phone: string; reference: string },
  ) =>
    request<{ token: string; state: ClaimState }>(`/${slug}/claim`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  status: (slug: string, token: string) => request<ClaimView>(`/${slug}/claim/${token}`),
  lookup: (slug: string, input: { phone: string; reference: string }) =>
    request<ClaimView>(`/${slug}/lookup`, { method: 'POST', body: JSON.stringify(input) }),
};
