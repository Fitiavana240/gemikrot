import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { routersApi } from '../api/routers';
import { useRouterSelection } from '../routers/RouterContext';
import { APP_NAME } from './Brand';

/**
 * Le pied de page : l'heure, le routeur, la version.
 *
 * Trois choses qu'on cherche sans savoir où les chercher. L'heure surtout :
 * c'est **celle du routeur** qui décide des expirations, et une console dont
 * la pendule avance de dix minutes annonce des coupures qui n'ont pas eu
 * lieu. L'écart entre les deux ne se voyait nulle part.
 */

/** Au-delà, les deux horloges ne racontent plus la même journée. */
const ÉCART_NOTABLE_MS = 120_000;

/**
 * L'heure du routeur, qui avance toute seule entre deux relevés.
 *
 * On ne demande pas l'heure au routeur chaque seconde : on relève une fois
 * l'**écart** avec l'horloge du poste, puis on le reporte. Le routeur garde
 * donc la main sur l'heure affichée, sans qu'on l'interroge pour rien.
 */
function useHeureDuRouteur(iso: string | null) {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  /**
   * L'écart, relevé **une fois** par lecture de l'horloge.
   *
   * Le recalculer à chaque rendu — `relevé - Date.now()` dans le corps du
   * composant — donne `maintenant + relevé - maintenant`, c'est-à-dire le
   * relevé lui-même : la pendule reste figée sur l'heure du dernier appel et
   * ne bat plus. Constaté à l'essai, deux secondes après le rendu.
   */
  const écart = useRef<number | null>(null);

  useEffect(() => {
    if (!iso) {
      écart.current = null;
      return;
    }
    const relevé = Date.parse(iso);
    écart.current = Number.isNaN(relevé) ? null : relevé - Date.now();
  }, [iso]);

  useEffect(() => {
    const battement = window.setInterval(() => setMaintenant(Date.now()), 1000);
    return () => window.clearInterval(battement);
  }, []);

  if (écart.current === null) return { heure: null, écartMs: 0 };
  return { heure: new Date(maintenant + écart.current), écartMs: écart.current };
}

/**
 * Le modèle est-il déjà dans le nom que l'exploitant a donné au routeur ?
 *
 * Sur ce parc il l'est — « hAP ac² — Zone WIFI-TATI » — et le pied affichait
 * « hAP ac² … hAP ac^2 » à deux mots d'intervalle. RouterOS écrit `ac^2` là
 * où l'exploitant tape `ac²` : comparer les chaînes telles quelles ne voit
 * pas la répétition.
 */
function déjàDansLeNom(modèle: string | undefined, nom: string | undefined): boolean {
  if (!modèle || !nom) return false;
  const aplatir = (t: string) =>
    t
      .toLowerCase()
      .replace(/\^?([0-9])/g, '$1')
      .replace(/²/g, '2')
      .replace(/[^a-z0-9]/g, '');
  return aplatir(nom).includes(aplatir(modèle));
}

/** `1d2h3m4s` → `1 j 2 h`. Deux unités suffisent pour situer un redémarrage. */
function duréeLisible(uptime: string | undefined): string {
  if (!uptime) return '—';
  const parties = [...uptime.matchAll(/(\d+)([wdhms])/g)].map(
    ([, n, u]) => `${n} ${{ w: 'sem', d: 'j', h: 'h', m: 'min', s: 's' }[u]}`,
  );
  return parties.slice(0, 2).join(' ') || uptime;
}

/**
 * Le relevé du routeur, partagé par la bande du haut et le pied.
 *
 * Même clef de requête : React Query n'appelle qu'une fois, et les deux
 * affichages battent à la même seconde. Les séparer donnerait deux pendules
 * légèrement décalées sur le même écran, ce qui est pire que pas de pendule.
 */
function useÉtatRouteur() {
  const { currentId, current } = useRouterSelection();

  const état = useQuery({
    queryKey: ['etat-routeur', currentId],
    queryFn: () => routersApi.etat(currentId!),
    enabled: Boolean(currentId),
    // Une minute : l'heure s'entretient toute seule entre deux relevés, et
    // seuls la charge et la durée de marche justifient de redemander.
    refetchInterval: 60_000,
    retry: false,
  });

  const horloge = état.data?.clock;
  // RouterOS rend « 2026-09-21 13:45:02 » sans fuseau, et son décalage à
  // part : les recoller est la seule façon d'obtenir un instant absolu.
  const isoRouteur = horloge
    ? `${horloge.date}T${horloge.time}${horloge.gmtOffset || 'Z'}`
    : null;
  const { heure, écartMs } = useHeureDuRouteur(isoRouteur);
  const désaccord = Math.abs(écartMs) > ÉCART_NOTABLE_MS;

  const res = état.data?.resource;

  return { état, current, heure, horloge, désaccord, écartMs, res };
}

/**
 * L'heure du routeur, en tête et toujours visible.
 *
 * Elle était en pied de page, donc sous l'écran dès qu'on faisait défiler une
 * liste — c'est-à-dire presque toujours. Or c'est **elle** qui décide des
 * expirations : une console dont la pendule avance de dix minutes annonce des
 * coupures qui n'ont pas eu lieu, et on ne peut pas s'en apercevoir si le
 * chiffre n'est pas sous les yeux au moment où on lit la liste.
 *
 * Compacte, et sans ce que le pied dit déjà : le nom du routeur est à côté
 * dans la même barre, et la durée de marche ne se lit pas toutes les
 * minutes.
 */
export function BandeauÉtat() {
  const { état, heure, horloge, désaccord, écartMs } = useÉtatRouteur();

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-mono tabular-nums font-medium text-slate-700">
        {heure
          ? heure.toLocaleTimeString('fr-FR', { hour12: false })
          : état.isPending
            ? '—'
            : '—'}
      </span>
      {horloge?.gmtOffset && (
        <span className="hidden text-slate-400 sm:inline">UTC{horloge.gmtOffset}</span>
      )}
      {/* Le désaccord se dit ici aussi, et c'est tout l'intérêt de monter
          l'heure : le voir au moment où on lit une échéance. */}
      {désaccord && (
        <span
          className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800"
          title={`Votre appareil est ${écartMs < 0 ? 'en avance' : 'en retard'} de ${Math.round(
            Math.abs(écartMs) / 60_000,
          )} min sur le routeur`}
        >
          ⚠ {Math.round(Math.abs(écartMs) / 60_000)} min d&apos;écart
        </span>
      )}
    </div>
  );
}

export function Pied() {
  const { état, current, heure, horloge, désaccord, écartMs, res } = useÉtatRouteur();

  return (
    <footer className="mt-8 border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 lg:px-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {/* L'heure d'abord : c'est ce qu'on vient y chercher le plus souvent. */}
        <span className="flex items-center gap-1.5">
          <span className="text-slate-400">Heure du routeur</span>
          <span className="font-mono tabular-nums text-sm font-medium text-slate-700">
            {heure
              ? heure.toLocaleTimeString('fr-FR', { hour12: false })
              : état.isPending
                ? '—'
                : 'inconnue'}
          </span>
          {heure && (
            <span className="text-slate-400">
              {heure.toLocaleDateString('fr-FR', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
              })}
            </span>
          )}
          {horloge?.gmtOffset && <span className="text-slate-400">UTC{horloge.gmtOffset}</span>}
        </span>

        {/* L'écart n'est dit que s'il existe : une pendule juste n'a pas à
            occuper la ligne, et le taire quand elle est fausse ferait lire
            des coupures là où il n'y en a pas eu. */}
        {désaccord && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
            Votre appareil est {écartMs < 0 ? 'en avance' : 'en retard'} de{' '}
            {Math.round(Math.abs(écartMs) / 60_000)} min sur le routeur
          </span>
        )}

        <span className="hidden text-slate-300 sm:inline">·</span>

        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-slate-700">
            {current?.label ?? 'Aucun routeur'}
          </span>
          {res && (
            <>
              {!déjàDansLeNom(res.boardName, current?.label) && <span>{res.boardName}</span>}
              <span className="text-slate-400">RouterOS {res.version}</span>
              <span className="text-slate-400">en marche depuis {duréeLisible(res.uptime)}</span>
            </>
          )}
          {état.isError && <span className="text-red-600">routeur injoignable</span>}
        </span>

        {/* La version à droite, et en dernier : on la cherche une fois, pour
            dire laquelle on a quand quelque chose ne va pas. */}
        <span className="ml-auto flex items-center gap-1.5">
          <span className="text-slate-400">{APP_NAME}</span>
          <span className="font-mono font-medium text-slate-600">v{__APP_VERSION__}</span>
        </span>
      </div>
    </footer>
  );
}
