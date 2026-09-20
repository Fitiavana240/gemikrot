import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { MikrotikError, type MikrotikErrorCode } from '@wifitati/mikrotik-service';

/**
 * Traduit les erreurs du routeur en réponses HTTP.
 *
 * Sans ce filtre, toute erreur MikroTik qui remonte jusqu'au contrôleur
 * devient `500 — Internal server error` : le code et la phrase que NestJS
 * réserve à un défaut de la console elle-même. Or ces erreurs disent presque
 * toutes quelque chose d'utile, et de tout autre chose : le routeur ne répond
 * pas, il a refusé nos identifiants, l'entrée demandée n'existe plus chez
 * lui.
 *
 * Le cas qui a fait écrire ce filtre est le plus visible de tous. Le
 * disjoncteur rend déjà, lorsqu'il est ouvert, un message exact — « Routeur
 * « X » injoignable — Timeout après 5000 ms (nouvelle tentative dans 21 s) ».
 * Mais il ne s'ouvre qu'après plusieurs échecs : **les premiers appels, ceux
 * que l'exploitant voit justement quand la panne commence, rendaient
 * `Internal server error`**. La même panne donnait donc deux réponses
 * opposées, et la pire arrivait en premier — celle qui fait croire que la
 * console est cassée alors que c'est le lien qui est tombé.
 *
 * Aucun de ces messages ne porte de secret : les identifiants voyagent dans
 * un en-tête `Authorization`, jamais dans l'URL, et le texte des erreurs ne
 * contient que la méthode et le chemin RouterOS. Ce chemin est précisément ce
 * qui permet de dire à quelqu'un où regarder.
 */
interface Correspondance {
  statut: number;
  /** Nom HTTP du statut, tel que NestJS le rend d'ordinaire. */
  erreur: string;
  /**
   * Cause en clair, ajoutée devant le message technique. Vide quand celui-ci
   * se suffit : « Utilisateur introuvable : essai-42 » n'a pas besoin d'être
   * précédé d'une paraphrase.
   */
  phrase: string;
}

const CORRESPONDANCES: Record<MikrotikErrorCode, Correspondance> = {
  // 503 et non 500 : la console va bien, c'est sa dépendance qui est absente.
  // C'est aussi le code que rend le disjoncteur, et les deux réponses doivent
  // enfin concorder.
  CONNECTION_ERROR: {
    statut: 503,
    erreur: 'Service Unavailable',
    phrase: 'Le routeur ne répond pas.',
  },
  TIMEOUT: {
    statut: 503,
    erreur: 'Service Unavailable',
    phrase: "Le routeur n'a pas répondu dans le délai imparti.",
  },
  // Le routeur a bien répondu — il a dit non. Ce n'est ni une panne de lien
  // ni un défaut de la console : c'est un compte à corriger sur le routeur.
  AUTH_ERROR: {
    statut: 502,
    erreur: 'Bad Gateway',
    phrase: 'Le routeur a refusé les identifiants enregistrés pour lui.',
  },
  NOT_FOUND: { statut: 404, erreur: 'Not Found', phrase: '' },
  VALIDATION_ERROR: { statut: 400, erreur: 'Bad Request', phrase: '' },
  CONFLICT: { statut: 409, erreur: 'Conflict', phrase: '' },
  API_ERROR: {
    statut: 502,
    erreur: 'Bad Gateway',
    phrase: 'Le routeur a répondu une erreur.',
  },
  UNKNOWN: {
    statut: 502,
    erreur: 'Bad Gateway',
    phrase: "L'échange avec le routeur a échoué.",
  },
};

/** Le message rendu au client, cause en clair puis détail technique. */
export function messageLisible(error: MikrotikError): string {
  const { phrase } = CORRESPONDANCES[error.code] ?? CORRESPONDANCES.UNKNOWN;
  return phrase ? `${phrase} ${error.message}` : error.message;
}

@Catch(MikrotikError)
export class MikrotikExceptionFilter implements ExceptionFilter<MikrotikError> {
  private readonly logger = new Logger(MikrotikExceptionFilter.name);

  catch(error: MikrotikError, host: ArgumentsHost): void {
    const correspondance = CORRESPONDANCES[error.code] ?? CORRESPONDANCES.UNKNOWN;
    const réponse = host.switchToHttp().getResponse<Response>();

    // Une panne de lien n'est pas un incident de code : elle se journalise en
    // avertissement, sans pile d'appels. Noyer le journal d'exceptions à
    // chaque coupure de courant rend illisibles les vraies.
    const journal = correspondance.statut >= 500 && error.code !== 'CONNECTION_ERROR' && error.code !== 'TIMEOUT';
    if (journal) this.logger.error(error.message, error.stack);
    else this.logger.warn(error.message);

    réponse.status(correspondance.statut).json({
      statusCode: correspondance.statut,
      error: correspondance.erreur,
      message: messageLisible(error),
      // Le code brut permet à un écran de réagir sans analyser une phrase.
      routerErrorCode: error.code,
    });
  }
}
