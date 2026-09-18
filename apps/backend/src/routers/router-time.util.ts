/**
 * RouterOS date ses valeurs **sans fuseau** : `end-time` vaut
 * `"2026-09-17 14:48:58"`, à lire dans le fuseau du routeur. Le hAP de
 * Toliara tourne en `Africa/Nairobi`, soit `+03:00`.
 *
 * `new Date("2026-09-17 14:48:58")` interprète cette chaîne dans le fuseau du
 * serveur Node. Tant que le serveur est à la même heure que le routeur, le
 * décalage passe inaperçu ; hébergé en UTC, il décale **toutes** les
 * échéances de trois heures — dans le sens qui suspend les clients trop tôt.
 *
 * L'offset est lu sur le routeur lui-même (`/system/clock`), jamais supposé :
 * un exploitant peut déployer ailleurs.
 */
export function parseRouterTime(raw: string | null | undefined, gmtOffset: string): Date | null {
  if (!raw) return null;
  // Valeurs sentinelles de RouterOS, qui ne sont pas des dates.
  if (raw === 'unlimited' || raw === 'not-yet-running') return null;

  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(raw.trim());
  if (!match) {
    // Déjà horodatée (ou illisible) : on laisse Date trancher plutôt que de
    // fabriquer une valeur.
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  const offset = normalizeOffset(gmtOffset);
  const parsed = new Date(`${match[1]}T${match[2]}${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Accepte `+03:00`, `+0300`, `03:00`, et retombe sur UTC si c'est illisible. */
function normalizeOffset(gmtOffset: string | null | undefined): string {
  if (!gmtOffset) return 'Z';
  const match = /^([+-]?)(\d{2}):?(\d{2})$/.exec(gmtOffset.trim());
  if (!match) return 'Z';
  const sign = match[1] === '-' ? '-' : '+';
  return `${sign}${match[2]}:${match[3]}`;
}
