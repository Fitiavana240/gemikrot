import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * Tentatives ratées tolérées pour un couple compte + adresse.
 *
 * Assez pour une main maladroite et un gestionnaire de mots de passe qui
 * insiste, loin en deçà de ce qu'exige une attaque : la politique n'impose
 * que six caractères, et sans plafond un automate épuise un mot de passe
 * court en quelques minutes.
 */
const MAX_PAR_COMPTE = 10;

/**
 * Filet plus large, par adresse seule.
 *
 * Il attrape l'automate qui balaie plusieurs comptes depuis un même point,
 * ce que le compteur par compte ne voit pas. Volontairement généreux : la
 * console peut être ouverte par plusieurs personnes derrière une seule
 * sortie Internet.
 */
const MAX_PAR_ADRESSE = 50;

/** Quinze minutes : une gêne pour qui se trompe, un mur pour qui devine. */
const FENETRE_MS = 15 * 60_000;

interface Compteur {
  echecs: number;
  expireA: number;
}

/**
 * Freine les essais de mot de passe sur la connexion.
 *
 * Il n'y en avait aucun : douze tentatives de suite ont rendu douze 401,
 * mesuré sur le serveur. `RateLimitGuard` n'y répondait pas, et n'y
 * répondrait pas bien — il compte **toutes** les requêtes, si bien qu'un
 * exploitant qui se connecte souvent se bloquerait lui-même. Ici seuls les
 * échecs comptent, et une connexion réussie efface l'ardoise.
 *
 * La clé stricte associe le compte **et** l'adresse. Compter sur le seul
 * compte laisserait n'importe qui verrouiller l'exploitant hors de sa propre
 * console en devinant son adresse électronique — le remède serait pire.
 *
 * Compteurs en mémoire, comme `RateLimitGuard` : suffisant tant qu'un seul
 * processus sert l'application, à déplacer le jour où il y en a deux.
 */
@Injectable()
export class LoginThrottleService {
  private readonly compteurs = new Map<string, Compteur>();
  private dernierBalayage = Date.now();

  /** Lève si le seuil est déjà atteint. Ne compte rien : voir `echec`. */
  verifier(email: string, ip?: string): void {
    const maintenant = Date.now();
    this.balayer(maintenant);

    for (const [cle, plafond] of this.cles(email, ip)) {
      const c = this.compteurs.get(cle);
      if (c && c.expireA > maintenant && c.echecs >= plafond) {
        const secondes = Math.ceil((c.expireA - maintenant) / 1000);
        const delai =
          secondes > 60 ? `${Math.ceil(secondes / 60)} minutes` : `${secondes} secondes`;
        throw new HttpException(
          `Trop de tentatives de connexion. Réessayez dans ${delai}.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  /** À appeler après un mot de passe refusé. */
  echec(email: string, ip?: string): void {
    const maintenant = Date.now();
    for (const [cle] of this.cles(email, ip)) {
      const c = this.compteurs.get(cle);
      if (!c || c.expireA <= maintenant) {
        this.compteurs.set(cle, { echecs: 1, expireA: maintenant + FENETRE_MS });
      } else {
        c.echecs += 1;
      }
    }
  }

  /**
   * À appeler après une connexion réussie.
   *
   * Seule la clé du compte est effacée, pas celle de l'adresse : sinon une
   * seule connexion valide remettrait à zéro le filet qui protège tous les
   * autres comptes atteignables depuis ce point.
   */
  succes(email: string, ip?: string): void {
    this.compteurs.delete(this.cleCompte(email, ip));
  }

  private cleCompte(email: string, ip?: string): string {
    return `compte:${email.trim().toLowerCase()}|${ip ?? '-'}`;
  }

  private cles(email: string, ip?: string): [string, number][] {
    const cles: [string, number][] = [[this.cleCompte(email, ip), MAX_PAR_COMPTE]];
    if (ip) cles.push([`adresse:${ip}`, MAX_PAR_ADRESSE]);
    return cles;
  }

  /** Purge périodique : sans elle, la table grossit indéfiniment. */
  private balayer(maintenant: number): void {
    if (maintenant - this.dernierBalayage < 60_000) return;
    this.dernierBalayage = maintenant;
    for (const [cle, c] of this.compteurs) {
      if (c.expireA <= maintenant) this.compteurs.delete(cle);
    }
  }
}
