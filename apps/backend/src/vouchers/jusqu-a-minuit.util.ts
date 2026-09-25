/**
 * Combien de temps reste-t-il jusqu'à minuit, **sur le routeur** ?
 *
 * Une offre « jusqu'à minuit » ne peut pas porter une durée fixe : elle vaut
 * sept heures à dix-sept heures et dix minutes à vingt-trois heures
 * cinquante. La durée se calcule donc au tirage, et c'est ce que User Manager
 * sait recevoir — il compte une durée, jamais une date de fin. La
 * documentation est explicite : une fois la session commencée, *« the end
 * time cannot then be changed »*.
 *
 * **Minuit est celui du routeur, jamais celui du serveur.** Le hAP de Toliara
 * tourne en `+03:00` et le serveur en France ; prendre l'heure du serveur
 * ferait mourir les tickets trois heures trop tôt, chaque nuit, sans que rien
 * ne le signale. Le projet lit déjà l'offset sur `/system/clock` pour les
 * échéances — la même règle vaut ici, et pour la même raison.
 */

/** Une journée entière, quand il ne reste presque rien. */
const JOUR = 24 * 3600;

/**
 * Le plancher, en secondes.
 *
 * Un ticket tiré à 23 h 59 vaudrait une minute : le client paie, se connecte,
 * et perd son accès avant d'avoir ouvert une page. Sous ce seuil on donne la
 * journée suivante entière — c'est ce qu'un vendeur ferait de lui-même, et
 * c'est plus honnête que de vendre soixante secondes.
 */
export const PLANCHER_SECONDES = 30 * 60;

/** `+03:00`, `+0300`, `03:00`, `-0400`… en minutes. `null` si illisible. */
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
 * Secondes jusqu'au prochain minuit dans le fuseau du routeur.
 *
 * `null` quand l'offset est illisible : mieux vaut refuser de tirer que de
 * poser une durée fausse sur des tickets qu'on vend.
 */
export function secondesJusquAMinuit(
  maintenant: Date,
  gmtOffset: string | null | undefined,
): number | null {
  const offset = offsetEnMinutes(gmtOffset);
  if (offset === null) return null;

  // L'heure locale du routeur, obtenue en décalant l'instant absolu. On ne
  // lit surtout pas `getHours()` — il rendrait l'heure du serveur.
  const localeMs = maintenant.getTime() + offset * 60_000;
  const secondesDansLaJournée = Math.floor(localeMs / 1000) % JOUR;
  // Le modulo de JavaScript garde le signe du dividende : avant 1970, ou avec
  // un offset négatif sur un instant proche de l'époque, il rendrait un
  // nombre négatif. Le ramener dans [0, JOUR[ coûte une ligne.
  const écoulées = ((secondesDansLaJournée % JOUR) + JOUR) % JOUR;

  const reste = JOUR - écoulées;
  return reste < PLANCHER_SECONDES ? reste + JOUR : reste;
}

/**
 * Le suffixe du profil qui portera cette durée.
 *
 * Arrondi à l'heure supérieure, et c'est délibéré : à la minute près, chaque
 * tirage créerait un profil de plus sur le routeur. À l'heure, il y en a au
 * plus vingt-quatre par offre, et en pratique quelques-uns — un exploitant
 * tire ses tickets aux mêmes moments de la journée.
 *
 * Arrondi **vers le haut** : mieux vaut quelques minutes de trop que de
 * vendre un accès qui meurt avant minuit.
 */
export function suffixeMinuit(secondes: number): string {
  return `minuit-${Math.ceil(secondes / 3600)}h`;
}
