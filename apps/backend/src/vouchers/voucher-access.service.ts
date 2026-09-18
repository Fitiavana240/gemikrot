import { Injectable, Logger } from '@nestjs/common';
import type { IMikrotikService } from '@wifitati/mikrotik-service';

/**
 * Coupe réellement l'accès d'un compte, ou le rétablit.
 *
 * Désactiver le compte ne suffit pas. Le profil serveur de ce parc accepte
 * `login-by: mac, cookie, http-chap, https, http-pap, mac-cookie`, avec une
 * durée de vie de cookie de trois jours : un client dont le cookie est encore
 * valide se reconnecte **sans repasser par RADIUS**, donc sans que User
 * Manager ne soit consulté. Relevé sur le routeur — deux des six sessions
 * actives y sont entrées par `mac-cookie`, avec `radius: false`.
 *
 * Couper suppose donc trois gestes : désactiver le compte, effacer ses
 * cookies, et fermer la session en cours. Sans les deux derniers, un ticket
 * expiré continue de servir jusqu'à trois jours.
 */
@Injectable()
export class VoucherAccessService {
  private readonly logger = new Logger(VoucherAccessService.name);

  /** Renvoie ce qui a été réellement coupé, pour l'audit et l'affichage. */
  async revoke(
    mikrotik: IMikrotikService,
    username: string,
    options: { disableAccount?: boolean } = {},
  ): Promise<{ cookiesRemoved: number; sessionsClosed: number }> {
    if (options.disableAccount !== false) {
      await mikrotik.setUserManagerUserDisabled(username, true);
    }

    const cookiesRemoved = await this.purgeCookies(mikrotik, username);
    const sessionsClosed = await this.closeSessions(mikrotik, username);

    if (cookiesRemoved || sessionsClosed) {
      this.logger.log(
        `Accès coupé pour ${username} : ${cookiesRemoved} cookie(s), ${sessionsClosed} session(s)`,
      );
    }
    return { cookiesRemoved, sessionsClosed };
  }

  /**
   * Efface les cookies d'un compte. Une erreur sur l'un d'eux n'interrompt
   * pas les autres : un cookie déjà expiré entre-temps ne doit pas empêcher
   * de purger les suivants.
   */
  async purgeCookies(mikrotik: IMikrotikService, username: string): Promise<number> {
    const cookies = await mikrotik.getHotspotCookies();
    const mine = cookies.filter((cookie) => cookie.username === username);

    let removed = 0;
    for (const cookie of mine) {
      try {
        await mikrotik.deleteHotspotCookie(cookie.id);
        removed += 1;
      } catch (error) {
        this.logger.warn(`Cookie ${cookie.id} non supprimé : ${String(error)}`);
      }
    }
    return removed;
  }

  /** Ferme les sessions HotSpot en cours du compte. */
  async closeSessions(mikrotik: IMikrotikService, username: string): Promise<number> {
    const active = await mikrotik.getHotspotActiveUsers();
    const mine = active.filter((session) => session.username === username);

    let closed = 0;
    for (const session of mine) {
      try {
        await mikrotik.disconnectHotspotUser({ sessionId: session.id });
        closed += 1;
      } catch (error) {
        this.logger.warn(`Session ${session.id} non fermée : ${String(error)}`);
      }
    }
    return closed;
  }
}
