import { describe, expect, it, vi } from 'vitest';
import {
  MikrotikApiError,
  MikrotikAuthError,
  MikrotikConflictError,
  MikrotikConnectionError,
  MikrotikNotFoundError,
  MikrotikTimeoutError,
  MikrotikValidationError,
} from '@wifitati/mikrotik-service';
import { MikrotikExceptionFilter } from './mikrotik-exception.filter.js';

/** Un `ArgumentsHost` réduit à ce que le filtre en utilise. */
function hôte() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return {
    host: { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as never,
    status,
    json,
  };
}

function rendu(error: Error) {
  const { host, status, json } = hôte();
  new MikrotikExceptionFilter().catch(error as never, host);
  return { statut: status.mock.calls[0][0], corps: json.mock.calls[0][0] };
}

describe('MikrotikExceptionFilter', () => {
  it("ne rend jamais 500 : la console n'est pas en cause", () => {
    // C'est tout le propos. `500 — Internal server error` désigne un défaut
    // de la console ; aucune de ces erreurs n'en est un.
    const erreurs = [
      new MikrotikConnectionError('Connexion à RouterOS impossible pour GET /system/resource'),
      new MikrotikTimeoutError('Timeout après 5000ms pour GET /ip/dhcp-server/lease'),
      new MikrotikAuthError(),
      new MikrotikNotFoundError('Utilisateur', 'essai-42'),
      new MikrotikValidationError('Nom vide'),
      new MikrotikConflictError('Utilisateur déjà existant'),
      new MikrotikApiError('RouterOS a répondu 418 pour GET /rien'),
    ];
    for (const erreur of erreurs) {
      expect(rendu(erreur).statut, erreur.name).not.toBe(500);
    }
  });

  it('rend 503 pour une panne de lien, comme le disjoncteur', () => {
    // Le disjoncteur ouvert rendait déjà 503 ; avant ce filtre, les premiers
    // appels — ceux que l'exploitant voit quand la panne commence — rendaient
    // 500. La même panne donnait deux réponses opposées.
    for (const erreur of [
      new MikrotikConnectionError('Connexion à RouterOS impossible pour GET /system/resource'),
      new MikrotikTimeoutError('Timeout après 5000ms pour GET /ip/dhcp-server/lease'),
    ]) {
      expect(rendu(erreur).statut).toBe(503);
    }
  });

  it('distingue le routeur muet du routeur qui refuse', () => {
    // Les deux remèdes n'ont rien à voir : rétablir un lien, ou corriger un
    // compte sur le routeur. Les confondre envoie dépanner le mauvais objet.
    expect(rendu(new MikrotikAuthError()).statut).toBe(502);
    expect(rendu(new MikrotikConnectionError('x')).statut).toBe(503);
  });

  it('rend au client les codes que sa demande justifie', () => {
    expect(rendu(new MikrotikNotFoundError('Utilisateur', 'essai-42')).statut).toBe(404);
    expect(rendu(new MikrotikValidationError('Nom vide')).statut).toBe(400);
    expect(rendu(new MikrotikConflictError('déjà existant')).statut).toBe(409);
  });

  it('préfixe une cause en clair sans effacer le détail technique', () => {
    const { corps } = rendu(new MikrotikTimeoutError('Timeout après 5000ms pour GET /ip/dhcp-server/lease'));
    expect(corps.message).toContain("Le routeur n'a pas répondu");
    // Le chemin RouterOS est ce qui permet de dire où regarder.
    expect(corps.message).toContain('/ip/dhcp-server/lease');
  });

  it('laisse les messages déjà explicites se suffire', () => {
    // « Utilisateur introuvable : essai-42 » n'a pas besoin d'une paraphrase.
    const { corps } = rendu(new MikrotikNotFoundError('Utilisateur', 'essai-42'));
    expect(corps.message).toBe('Utilisateur introuvable : essai-42');
  });

  it('expose le code brut, pour qu\'un écran réagisse sans lire une phrase', () => {
    expect(rendu(new MikrotikAuthError()).corps.routerErrorCode).toBe('AUTH_ERROR');
  });
});
