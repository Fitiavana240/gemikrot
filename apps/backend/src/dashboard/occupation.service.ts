import { Injectable } from '@nestjs/common';
import type { UserManagerSessionDto, AddressPoolDto } from '@wifitati/mikrotik-service';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';

/**
 * À quelle heure le réseau se remplit — et de combien il peut se remplir.
 *
 * Deux choses qu'on ne peut pas deviner de tête : l'heure où les gens
 * arrivent, et le plafond qu'ils finiront par atteindre. La première décide
 * quand brider, la seconde quand agrandir.
 *
 * **La source est le journal RADIUS du routeur**, et il est court : RouterOS
 * n'en garde qu'un nombre limité d'entrées, puis les efface. Le profil rendu
 * ici ne vaut donc que ce que vaut cet échantillon, et c'est pourquoi sa
 * taille et sa période sont rendues avec lui plutôt que tues. Un profil
 * calculé sur vingt sessions n'est pas une statistique, c'est une
 * indication — et l'écran doit pouvoir le dire.
 */

/** Ce que le HotSpot prend en plus du bail DHCP, faute de mieux mesuré. */
const ADRESSES_PAR_CLIENT_PAR_DÉFAUT = 1;

export interface TrancheHoraire {
  /** 0 à 23, heure locale du serveur. */
  heure: number;
  /** Sessions ouvertes en moyenne sur cette heure, tous jours confondus. */
  moyenne: number;
  /** Le plus grand nombre observé sur cette heure, un jour donné. */
  max: number;
}

export interface Occupation {
  depuis: string | null;
  jusqu: string | null;
  /** Taille de l'échantillon : sans elle, le profil se lit comme une vérité. */
  sessions: number;
  joursCouverts: number;
  parHeure: TrancheHoraire[];
  pointe: { quand: string; sessions: number } | null;
  /**
   * Combien de clients le réseau peut porter, d'après le bassin d'adresses.
   *
   * `null` quand le routeur ne rend pas ses bassins : mieux vaut pas de
   * plafond qu'un plafond inventé, dont on déduirait un taux faux.
   */
  plafondClients: number | null;
  /** Part du plafond atteinte à la pointe, ou `null` si le plafond est inconnu. */
  occupationPointe: number | null;
}

/**
 * Le profil horaire d'un jeu de sessions.
 *
 * Une session compte dans **toutes** les heures qu'elle traverse : quelqu'un
 * connecté de 18 h 40 à 20 h 10 occupe le réseau à 18, 19 et 20 h. Ne le
 * compter qu'à son heure de départ ferait disparaître les longues sessions,
 * qui sont précisément celles qui saturent.
 */
export function profilHoraire(
  sessions: { début: Date; fin: Date }[],
  maintenant = new Date(),
): { parHeure: TrancheHoraire[]; pointe: { quand: string; sessions: number } | null; joursCouverts: number } {
  // Clé « jour|heure » → nombre de sessions qui traversent cette heure-là.
  const seaux = new Map<string, number>();
  const jours = new Set<string>();

  for (const s of sessions) {
    const fin = s.fin > maintenant ? maintenant : s.fin;
    if (fin < s.début) continue;

    // On avance d'heure en heure depuis le début, plutôt que de calculer des
    // index : une session à cheval sur un changement d'heure ou sur minuit
    // se découpe alors toute seule.
    const curseur = new Date(
      s.début.getFullYear(),
      s.début.getMonth(),
      s.début.getDate(),
      s.début.getHours(),
    );
    // Une borne dure : une date aberrante — RouterOS rend
    // `1970-01-01` pour un compte jamais connecté — ferait tourner la boucle
    // un demi-million de fois.
    let gardeFou = 24 * 400;
    while (curseur <= fin && gardeFou-- > 0) {
      const jour = `${curseur.getFullYear()}-${curseur.getMonth()}-${curseur.getDate()}`;
      jours.add(jour);
      const clé = `${jour}|${curseur.getHours()}`;
      seaux.set(clé, (seaux.get(clé) ?? 0) + 1);
      curseur.setHours(curseur.getHours() + 1);
    }
  }

  const joursCouverts = Math.max(1, jours.size);
  const parHeure: TrancheHoraire[] = Array.from({ length: 24 }, (_, heure) => {
    const valeurs = [...seaux.entries()]
      .filter(([clé]) => Number(clé.split('|')[1]) === heure)
      .map(([, n]) => n);
    const somme = valeurs.reduce((a, b) => a + b, 0);
    return {
      heure,
      // Divisé par les jours **couverts**, pas par le nombre d'heures ayant
      // vu du monde : une heure creuse doit peser zéro dans la moyenne, pas
      // disparaître du calcul.
      moyenne: Math.round((somme / joursCouverts) * 10) / 10,
      max: valeurs.length > 0 ? Math.max(...valeurs) : 0,
    };
  });

  let pointe: { quand: string; sessions: number } | null = null;
  for (const [clé, n] of seaux) {
    if (pointe && n <= pointe.sessions) continue;
    const [jour, heure] = clé.split('|');
    const [a, m, j] = jour.split('-').map(Number);
    pointe = { quand: new Date(a, m, j, Number(heure)).toISOString(), sessions: n };
  }

  return { parHeure, pointe, joursCouverts };
}

/**
 * Combien de clients le bassin peut porter.
 *
 * Le HotSpot prend une adresse **en plus** du bail DHCP pour chaque client,
 * en NAT un-pour-un : diviser la capacité par ce rapport est la seule façon
 * d'obtenir un nombre de clients plutôt qu'un nombre d'adresses.
 */
export function plafondDeClients(bassins: AddressPoolDto[]): number | null {
  const total = bassins.reduce((somme, b) => somme + (b.total ?? 0), 0);
  if (total === 0) return null;

  const baux = bassins.reduce(
    (n, b) => n + (b.byOwner.find((o) => o.owner === 'DHCP')?.count ?? 0),
    0,
  );
  const prises = bassins.reduce((n, b) => n + (b.used ?? 0), 0);
  const parClient = baux > 0 ? prises / baux : ADRESSES_PAR_CLIENT_PAR_DÉFAUT;

  return Math.floor(total / Math.max(1, parClient));
}

@Injectable()
export class OccupationService {
  constructor(private readonly clients: MikrotikClientFactory) {}

  async occupation(routerId?: string): Promise<Occupation> {
    const mikrotik = routerId
      ? await this.clients.forRouter(routerId)
      : await this.clients.forDefaultRouter();

    const [sessions, bassins] = await Promise.all([
      mikrotik.getUserManagerSessions(),
      // Le plafond est un supplément : un routeur qui ne rend pas ses
      // bassins doit quand même donner son profil horaire.
      mikrotik.getAddressPools().catch(() => [] as AddressPoolDto[]),
    ]);

    const intervalles = sessions
      .map((s: UserManagerSessionDto) => ({
        début: new Date(s.startTime),
        // Une session en cours n'a pas de fin : elle court jusqu'à maintenant.
        fin: s.stopTime ? new Date(s.stopTime) : new Date(),
      }))
      .filter((i) => !Number.isNaN(i.début.getTime()) && !Number.isNaN(i.fin.getTime()));

    const { parHeure, pointe, joursCouverts } = profilHoraire(intervalles);
    const plafondClients = plafondDeClients(bassins);

    const bornes = intervalles.map((i) => i.début.getTime());
    return {
      depuis: bornes.length > 0 ? new Date(Math.min(...bornes)).toISOString() : null,
      jusqu: bornes.length > 0 ? new Date(Math.max(...bornes)).toISOString() : null,
      sessions: intervalles.length,
      joursCouverts,
      parHeure,
      pointe,
      plafondClients,
      occupationPointe:
        pointe && plafondClients ? Math.min(1, pointe.sessions / plafondClients) : null,
    };
  }
}
