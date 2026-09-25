import { parseRouterTime } from '../routers/router-time.util.js';

/**
 * Ce que les clients ont consommé, par jour, par semaine, par mois.
 *
 * Les sessions vivent sur le routeur et portent des dates **sans fuseau** :
 * `"2026-09-26 14:48:58"`, à lire dans l'heure du routeur. Découper la
 * journée avec l'heure du serveur ferait tomber trois heures de sessions dans
 * la mauvaise journée — le hAP de Toliara tourne en `+03:00`, le serveur en
 * UTC. Tout ce qui se passe entre minuit et trois heures là-bas serait
 * compté la veille, chaque nuit.
 *
 * C'est pourquoi ce calcul vit ici et non dans le navigateur : l'offset se
 * lit sur le routeur, et `parseRouterTime` sait déjà s'en servir.
 */

/** Le minimum qu'une session doit porter pour être comptée. */
export interface SessionÀCompter {
  username: string;
  /** Tel que le routeur l'écrit, sans fuseau. */
  startTime: string;
  bytesIn: number;
  bytesOut: number;
}

export interface Tranche {
  octets: number;
  sessions: number;
}

export interface Consommation {
  /** L'offset du routeur, pour que l'écran puisse dire d'où vient le découpage. */
  fuseau: string;
  /** Combien de sessions ont été lues, et combien portaient une date lisible. */
  sessionsLues: number;
  sessionsDatées: number;
  jour: Tranche;
  semaine: Tranche;
  mois: Tranche;
  /** Du plus gros consommateur au plus petit, sur le mois. */
  parCompte: { username: string; octets: number; sessions: number }[];
}

/** Minuit du jour en cours, dans le fuseau du routeur, en instant absolu. */
function débutDeJournée(maintenant: Date, offsetMinutes: number): Date {
  const local = new Date(maintenant.getTime() + offsetMinutes * 60_000);
  const minuitLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return new Date(minuitLocal - offsetMinutes * 60_000);
}

/** Lundi de la semaine en cours, dans le fuseau du routeur. */
function débutDeSemaine(maintenant: Date, offsetMinutes: number): Date {
  const jour = débutDeJournée(maintenant, offsetMinutes);
  const local = new Date(jour.getTime() + offsetMinutes * 60_000);
  // Semaine ISO : lundi premier jour, comme le découpage des recettes.
  const recul = (local.getUTCDay() + 6) % 7;
  return new Date(jour.getTime() - recul * 86_400_000);
}

/** Premier du mois en cours, dans le fuseau du routeur. */
function débutDeMois(maintenant: Date, offsetMinutes: number): Date {
  const local = new Date(maintenant.getTime() + offsetMinutes * 60_000);
  const premier = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return new Date(premier - offsetMinutes * 60_000);
}

/** `+03:00`, `+0300`, `03:00`… en minutes. `null` si illisible. */
export function offsetEnMinutes(gmtOffset: string | null | undefined): number | null {
  if (!gmtOffset) return null;
  const brut = gmtOffset.trim();
  if (/^(utc|gmt|z)$/i.test(brut)) return 0;
  const m = /^([+-]?)(\d{1,2}):?(\d{2})$/.exec(brut);
  if (!m) return null;
  const heures = Number(m[2]);
  const minutes = Number(m[3]);
  if (heures > 14 || minutes > 59) return null;
  return (m[1] === '-' ? -1 : 1) * (heures * 60 + minutes);
}

/**
 * Agrège les sessions en trois tranches et un classement par compte.
 *
 * **Une session sans date lisible n'est comptée nulle part**, et le rapport
 * dit combien il y en avait. La ranger « aujourd'hui » par défaut gonflerait
 * le chiffre du jour d'un montant que personne ne pourrait expliquer ; la
 * ranger au mois ferait mentir le total. Le nombre affiché à côté est la
 * seule réponse honnête.
 */
export function agrégerConsommation(
  sessions: SessionÀCompter[],
  gmtOffset: string,
  maintenant = new Date(),
): Consommation {
  const offset = offsetEnMinutes(gmtOffset) ?? 0;
  const débutJour = débutDeJournée(maintenant, offset);
  const débutSemaine = débutDeSemaine(maintenant, offset);
  const débutMois = débutDeMois(maintenant, offset);

  const jour: Tranche = { octets: 0, sessions: 0 };
  const semaine: Tranche = { octets: 0, sessions: 0 };
  const mois: Tranche = { octets: 0, sessions: 0 };
  const parCompte = new Map<string, { octets: number; sessions: number }>();

  let datées = 0;
  for (const s of sessions) {
    const début = parseRouterTime(s.startTime, gmtOffset);
    if (!début) continue;
    datées += 1;

    const octets = (Number(s.bytesIn) || 0) + (Number(s.bytesOut) || 0);
    const ajouter = (t: Tranche) => {
      t.octets += octets;
      t.sessions += 1;
    };

    // Les tranches s'emboîtent : une session d'aujourd'hui compte aussi dans
    // la semaine et dans le mois. C'est ce qu'un exploitant attend en lisant
    // trois lignes l'une sous l'autre.
    if (début >= débutMois) {
      ajouter(mois);
      const cumul = parCompte.get(s.username) ?? { octets: 0, sessions: 0 };
      cumul.octets += octets;
      cumul.sessions += 1;
      parCompte.set(s.username, cumul);
    }
    if (début >= débutSemaine) ajouter(semaine);
    if (début >= débutJour) ajouter(jour);
  }

  return {
    fuseau: gmtOffset,
    sessionsLues: sessions.length,
    sessionsDatées: datées,
    jour,
    semaine,
    mois,
    parCompte: [...parCompte.entries()]
      .map(([username, v]) => ({ username, ...v }))
      .sort((a, b) => b.octets - a.octets),
  };
}
