import { ApiError } from './client';

/**
 * Ce qu'il faut dire quand un appel au routeur échoue.
 *
 * Les écrans disaient tous la même phrase — « Le routeur n'a pas répondu » —
 * quel que soit l'échec. Or le routeur peut très bien avoir répondu, et avoir
 * dit non : identifiants refusés, service REST éteint, erreur RouterOS. On
 * envoyait alors vérifier un câble pendant que le vrai remède était un mot de
 * passe à corriger.
 *
 * Le serveur distingue désormais ces cas et rend un `routerErrorCode` ; cette
 * fonction est le seul endroit qui le traduit.
 */
const PHRASES: Record<string, string> = {
  CONNECTION_ERROR: "Le routeur n'a pas répondu.",
  TIMEOUT: "Le routeur n'a pas répondu dans le délai imparti.",
  AUTH_ERROR:
    'Le routeur a refusé les identifiants enregistrés pour lui — ce ne sont pas ses données qui manquent, mais son compte de service à corriger.',
  API_ERROR: 'Le routeur a répondu une erreur.',
  UNKNOWN: "L'échange avec le routeur a échoué.",
};

/**
 * Une phrase de cause, jamais vide.
 *
 * Sans code connu on retombe sur la formulation historique plutôt que sur le
 * message brut : une erreur réseau du navigateur rendrait « Failed to fetch »,
 * ce qui n'apprend rien à un vendeur au comptoir.
 */
export function phrasePanne(error: unknown): string {
  const code = error instanceof ApiError ? error.routerErrorCode : undefined;
  return (code && PHRASES[code]) || "Le routeur n'a pas répondu.";
}

/**
 * Vrai quand le lien lui-même est en cause, par opposition à un routeur qui
 * répond mais refuse. C'est la distinction qui décide du geste : vérifier le
 * lien, ou vérifier une configuration.
 */
export function estPanneDeLien(error: unknown): boolean {
  const code = error instanceof ApiError ? error.routerErrorCode : undefined;
  return code === undefined || code === 'CONNECTION_ERROR' || code === 'TIMEOUT';
}
