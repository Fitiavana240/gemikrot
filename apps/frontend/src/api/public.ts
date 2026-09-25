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
  /**
   * Le site d'ou vient le client, quand sa page captive le nomme.
   *
   * Un exploitant peut tenir plusieurs routeurs — plusieurs quartiers, un
   * meme reseau. Sans cette ligne, le client ne sait pas a quel site il
   * achete, et le vendeur qui recoit le paiement ne sait pas ou chercher.
   *
   * `null` pour une page captive posee avant que cette identite existe.
   */
  site: string | null;
  logoUrl: string | null;
  currency: string;
  plans: PublicPlan[];
  paymentAccounts: PublicPaymentAccount[];
  /**
   * Numéro WhatsApp d'assistance, ou `null` si l'exploitant n'en a pas posé.
   *
   * `null` et non chaîne vide : la page n'affiche le lien que s'il y a
   * quelqu'un derrière. Une porte d'assistance qui ne mène nulle part est
   * pire que pas d'assistance annoncée.
   */
  supportWhatsapp: string | null;
}

export type ClaimState = 'EN_ATTENTE' | 'VALIDE' | 'REFUSE';

export interface ClaimView {
  state: ClaimState;
  accessCode: string | null;
  /**
   * Le mot de passe, quand il diffère du code.
   *
   * `null` sur un ticket imprimé, où le code sert des deux côtés.
   */
  accessPassword: string | null;
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
  /**
   * L'exploitant a qui appartient l'adresse par laquelle on est arrive.
   *
   * Rend `{ slug: null }` quand l'adresse n'est celle de personne -- le cas de
   * la console, et le cas le plus frequent.
   */
  resoudreHote: () => request<{ slug: string | null }>('/resolution/hote'),
  tenant: (slug: string, routeur?: string) =>
    request<PublicTenant>(`/${slug}${routeur ? `?r=${encodeURIComponent(routeur)}` : ''}`),
  claim: (
    slug: string,
    input: {
      planId: string;
      accountId: string;
      phone: string;
      reference: string;
      /** Le nom du client : il deviendra son identifiant de connexion. */
      holderName: string;
      /**
       * Le routeur d'ou vient le client, tel que sa page captive le nomme.
       *
       * C'est lui qui decide **sur quel routeur le ticket sera cree**. Sans
       * lui, la verification retombe sur le plus ancien routeur de
       * l'exploitant : le client paie au site B et recoit un code qui ne
       * marche qu'au site A.
       */
      routerPublicId?: string;
    },
  ) =>
    // `identifiant` est celui que le serveur a **réservé** : sur un rejeu, il
    // peut différer de ce que le nom donnerait aujourd'hui.
    request<{ token: string; state: ClaimState; identifiant: string }>(`/${slug}/claim`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  status: (slug: string, token: string) => request<ClaimView>(`/${slug}/claim/${token}`),
  lookup: (slug: string, input: { phone: string; reference: string }) =>
    request<ClaimView>(`/${slug}/lookup`, { method: 'POST', body: JSON.stringify(input) }),
};
