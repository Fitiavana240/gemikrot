import { Injectable, NotFoundException } from '@nestjs/common';
import type { UserManagerSessionDto } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';

/**
 * Ce qu'un client a réellement consommé : durée et volume.
 *
 * La source est le **routeur**, jamais nos tables : lui seul voit les
 * connexions. Un client peut acheter dix tickets et n'en consommer qu'un —
 * nos tables diraient dix ventes, le routeur dit ce qui a servi.
 *
 * **Deux sources, et elles ne disent pas la même chose.**
 *
 * Les compteurs du compte HotSpot sont **cumulés depuis sa création** et ne
 * s'effacent jamais : c'est le total juste. Le journal RADIUS, lui, donne le
 * détail session par session — quand, combien de fois — mais RouterOS n'en
 * garde qu'un nombre limité puis efface les plus anciennes.
 *
 * Le premier essai a montré pourquoi les deux sont nécessaires : un abonné
 * de ce parc, avec 26 Gio au compteur, n'avait **aucune** session dans le
 * journal RADIUS. Se fier au seul journal aurait affiché zéro sur la fiche
 * du plus gros consommateur.
 */

export interface ConsommationParCompte {
  compte: string;
  /** D'où vient ce compte : un ticket acheté, ou l'abonnement au mois. */
  origine: 'ticket' | 'abonnement';
  /**
   * D'où viennent les chiffres de cette ligne.
   *
   * `compteur` : cumulé depuis la création du compte, jamais effacé — le
   * total juste. `sessions` : reconstitué depuis le journal RADIUS, donc un
   * plancher. `aucune` : ce compte n'existe ni dans l'un ni dans l'autre.
   */
  source: 'compteur' | 'sessions' | 'aucune';
  sessions: number;
  dureeSecondes: number;
  octetsRecus: number;
  octetsEnvoyes: number;
  /** Début de la plus ancienne session gardée, et fin de la plus récente. */
  premiere: string | null;
  derniere: string | null;
}

export interface Consommation {
  /** Les comptes rattachés au client, même sans aucune session. */
  comptes: number;
  sessions: number;
  dureeSecondes: number;
  octetsRecus: number;
  octetsEnvoyes: number;
  premiere: string | null;
  derniere: string | null;
  parCompte: ConsommationParCompte[];
  /**
   * Combien de sessions le journal du routeur contient **en tout**.
   *
   * Sans ce nombre, rien ne dit si l'on regarde un mois d'historique ou les
   * dernières heures. C'est ce qui permet de juger la valeur du reste.
   */
  sessionsDansLeJournal: number;
  /**
   * Vrai dès qu'une ligne s'appuie sur le seul journal RADIUS.
   *
   * L'écran doit alors dire que le total est un plancher. Quand tout vient
   * des compteurs, il est juste, et le nuancer serait une prudence trompeuse.
   */
  partiel: boolean;
}

/** Une session sans fin est en cours : elle court jusqu'à maintenant. */
function duréeDe(session: UserManagerSessionDto, maintenant: number): number {
  if (session.sessionTimeSeconds > 0) return session.sessionTimeSeconds;
  const début = Date.parse(session.startTime);
  if (Number.isNaN(début)) return 0;
  const fin = session.stopTime ? Date.parse(session.stopTime) : maintenant;
  return Number.isNaN(fin) ? 0 : Math.max(0, Math.round((fin - début) / 1000));
}

@Injectable()
export class ConsommationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: MikrotikClientFactory,
  ) {}

  async pourClient(customerId: string, routerId?: string): Promise<Consommation> {
    const client = await this.prisma.scoped.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!client) throw new NotFoundException(`Client ${customerId} introuvable`);

    const [tickets, abonnements] = await Promise.all([
      this.prisma.scoped.voucher.findMany({
        where: { customerId },
        select: { code: true, umUsername: true },
      }),
      this.prisma.scoped.subscription.findMany({
        where: { customerId },
        select: { hotspotUsername: true },
      }),
    ]);

    // `umUsername` quand il existe, `code` sinon : un ticket d'avant la
    // bascule vers User Manager n'a que son code, et c'est sous ce nom que
    // ses sessions ont été enregistrées.
    const origines = new Map<string, 'ticket' | 'abonnement'>();
    for (const t of tickets) origines.set(t.umUsername ?? t.code, 'ticket');
    for (const a of abonnements) origines.set(a.hotspotUsername, 'abonnement');

    // Deux lectures, filtrées ici : demander compte par compte ferait vingt
    // appels sur un client qui a acheté vingt tickets, contre deux.
    const mikrotik = routerId
      ? await this.clients.forRouter(routerId)
      : await this.clients.forDefaultRouter();
    const [journal, comptesHotspot] = await Promise.all([
      mikrotik.getUserManagerSessions(),
      // Les compteurs du compte : cumulés depuis sa création, jamais
      // effacés. Sans eux, un abonné dont les sessions ne passent pas par
      // RADIUS s'afficherait à zéro — c'est le cas sur ce parc.
      mikrotik.getHotspotUsers(),
    ]);
    const parNom = new Map(comptesHotspot.map((u) => [u.username, u]));

    const maintenant = Date.now();
    const parCompte = new Map<string, ConsommationParCompte>();
    for (const [compte, origine] of origines) {
      // Le compteur d'abord : c'est le total juste. Le journal viendra
      // au-dessus seulement si le compte n'a pas de compteur.
      const hotspot = parNom.get(compte);
      parCompte.set(compte, {
        compte,
        origine,
        source: hotspot ? 'compteur' : 'aucune',
        sessions: 0,
        dureeSecondes: hotspot?.uptimeSeconds ?? 0,
        octetsRecus: hotspot?.bytesIn ?? 0,
        octetsEnvoyes: hotspot?.bytesOut ?? 0,
        premiere: null,
        derniere: null,
      });
    }

    for (const session of journal) {
      const ligne = parCompte.get(session.username);
      if (!ligne) continue;
      ligne.sessions += 1;
      if (!ligne.premiere || session.startTime < ligne.premiere) ligne.premiere = session.startTime;
      const fin = session.stopTime ?? session.startTime;
      if (!ligne.derniere || fin > ligne.derniere) ligne.derniere = fin;

      // Les volumes ne s'additionnent que faute de compteur : les cumuler
      // par-dessus compterait deux fois le même trafic, le compteur du
      // compte incluant déjà toutes ses sessions.
      if (ligne.source === 'compteur') continue;
      ligne.source = 'sessions';
      ligne.dureeSecondes += duréeDe(session, maintenant);
      ligne.octetsRecus += session.bytesIn;
      ligne.octetsEnvoyes += session.bytesOut;
    }

    const lignes = [...parCompte.values()].sort((a, b) => b.dureeSecondes - a.dureeSecondes);
    const total = lignes.reduce(
      (acc, l) => ({
        sessions: acc.sessions + l.sessions,
        dureeSecondes: acc.dureeSecondes + l.dureeSecondes,
        octetsRecus: acc.octetsRecus + l.octetsRecus,
        octetsEnvoyes: acc.octetsEnvoyes + l.octetsEnvoyes,
      }),
      { sessions: 0, dureeSecondes: 0, octetsRecus: 0, octetsEnvoyes: 0 },
    );

    const débuts = lignes.map((l) => l.premiere).filter((d): d is string => d != null);
    const fins = lignes.map((l) => l.derniere).filter((d): d is string => d != null);

    return {
      comptes: lignes.length,
      ...total,
      premiere: débuts.length > 0 ? débuts.sort()[0] : null,
      derniere: fins.length > 0 ? fins.sort().at(-1)! : null,
      parCompte: lignes,
      sessionsDansLeJournal: journal.length,
      partiel: lignes.some((l) => l.source === 'sessions'),
    };
  }
}
