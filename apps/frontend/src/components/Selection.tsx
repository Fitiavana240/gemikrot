import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Cocher des lignes, puis agir sur le lot.
 *
 * Chaque ligne portait ses boutons — « Changer le code », « Suspendre »,
 * « Supprimer » — tous rouges, tous côte à côte, tous à portée d'un clic de
 * travers. Et pour suspendre vingt tickets il fallait vingt allers-retours.
 *
 * On coche donc, puis on agit une fois. Le geste destructeur passe par une
 * fenêtre qui **nomme le nombre**, ce qu'aucun bouton de ligne ne faisait.
 *
 * Cocher chacune à la main marche, mais c'est le dernier recours : sur six
 * cents comptes on ne coche pas à la main. D'où les sélections groupées —
 * tout, par profil, par état, et par plage avec Maj+clic.
 */

export type Groupe = {
  /** Ce qui sera écrit dans le menu : « 2Heure-500Ar », « expirés »… */
  libellé: string;
  /** Les lignes que ce groupe désigne. Leur nombre est dit dans le menu. */
  clés: string[];
};

export function useSelection(clésVisibles: string[]) {
  const [choisies, setChoisies] = useState<ReadonlySet<string>>(new Set());
  /** La dernière ligne cochée à la main, origine d'une plage Maj+clic. */
  const ancre = useRef<string | null>(null);

  // Une ligne disparue du filtre ne doit pas rester choisie en douce : agir
  // sur ce qu'on ne voit plus est exactement ce qu'on cherche à éviter.
  const visibles = useMemo(() => new Set(clésVisibles), [clésVisibles]);
  const retenues = useMemo(
    () => [...choisies].filter((c) => visibles.has(c)),
    [choisies, visibles],
  );

  const basculer = useCallback(
    (clé: string, avecMaj = false) => {
      setChoisies((avant) => {
        const après = new Set(avant);

        // Maj+clic prend tout ce qui sépare l'ancre de la ligne cliquée, dans
        // l'ordre affiché. C'est « par ordre » : la plage suit le tri de la
        // table, pas l'ordre dans lequel on a cliqué.
        if (avecMaj && ancre.current != null) {
          const début = clésVisibles.indexOf(ancre.current);
          const fin = clésVisibles.indexOf(clé);
          if (début !== -1 && fin !== -1) {
            const [a, b] = début <= fin ? [début, fin] : [fin, début];
            for (const k of clésVisibles.slice(a, b + 1)) après.add(k);
            return après;
          }
        }

        if (après.has(clé)) après.delete(clé);
        else après.add(clé);
        ancre.current = clé;
        return après;
      });
    },
    [clésVisibles],
  );

  const poser = useCallback((clés: string[]) => {
    ancre.current = null;
    setChoisies(new Set(clés));
  }, []);

  const vider = useCallback(() => {
    ancre.current = null;
    setChoisies(new Set());
  }, []);

  return {
    /** Les lignes choisies **et encore visibles**. */
    choisies: retenues,
    nombre: retenues.length,
    estChoisie: (clé: string) => choisies.has(clé),
    basculer,
    poser,
    vider,
  };
}

/** La case d'une ligne. Maj+clic étend depuis la dernière cochée. */
export function CaseLigne({
  cochée,
  onBasculer,
  libellé,
}: {
  cochée: boolean;
  onBasculer: (avecMaj: boolean) => void;
  /** Pour les lecteurs d'écran : « choisir H872973 ». */
  libellé: string;
}) {
  return (
    <td className="w-8 px-3 py-2">
      <input
        type="checkbox"
        checked={cochée}
        aria-label={`Choisir ${libellé}`}
        // `onClick` et non `onChange` : c'est lui qui porte la touche Maj.
        onClick={(e) => onBasculer(e.shiftKey)}
        onChange={() => undefined}
        className="h-4 w-4 cursor-pointer rounded border-slate-300 text-sky-600 focus:ring-sky-500"
      />
    </td>
  );
}

/**
 * La barre qui surmonte la table : ce qui est choisi, comment le choisir
 * autrement, et ce qu'on peut en faire.
 *
 * Elle reste en place même à zéro ligne choisie — les sélections groupées
 * sont le chemin normal, pas un secours. Les actions, elles, n'apparaissent
 * que lorsqu'il y a de quoi agir : un bouton « Supprimer les 0 » n'a pas de
 * sens et invite au clic à vide.
 */
export function BarreSelection({
  nombre,
  total,
  groupes,
  onTout,
  onRien,
  onChoisir,
  actions,
}: {
  nombre: number;
  total: number;
  /** Les sélections groupées, par famille : profil, état, offre… */
  groupes?: { titre: string; entrées: Groupe[] }[];
  onTout: () => void;
  onRien: () => void;
  /** Remplace la sélection par les lignes d'un groupe. */
  onChoisir: (clés: string[]) => void;
  /** Ce qu'on peut faire du lot. Rendu seulement si `nombre > 0`. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-sm text-slate-600">
        {nombre === 0 ? (
          <>Aucune ligne choisie</>
        ) : (
          <>
            <strong className="tabular-nums">{nombre}</strong> sur {total} choisie
            {nombre > 1 ? 's' : ''}
          </>
        )}
      </span>

      <button type="button" onClick={onTout} className={LIEN}>
        Tout ({total})
      </button>
      {nombre > 0 && (
        <button type="button" onClick={onRien} className={LIEN}>
          Rien
        </button>
      )}

      {groupes?.map((famille) => (
        <MenuGroupe key={famille.titre} famille={famille} onChoisir={onChoisir} />
      ))}

      {nombre > 0 && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const LIEN =
  'rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 hover:text-sky-900';

/**
 * Un menu de sélections groupées.
 *
 * Chaque entrée dit **combien** elle désigne : « expirés (34) ». Sans ce
 * nombre on clique en aveugle, et c'est une sélection qui mène ensuite à une
 * suppression.
 */
function MenuGroupe({
  famille,
  onChoisir,
}: {
  famille: { titre: string; entrées: Groupe[] };
  onChoisir: (clés: string[]) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  // Un groupe sans ligne n'est pas une option : il ne ferait que du bruit.
  const utiles = famille.entrées.filter((e) => e.clés.length > 0);
  if (utiles.length === 0) return null;

  return (
    <div className="relative">
      <button type="button" onClick={() => setOuvert((o) => !o)} className={LIEN}>
        {famille.titre} ▾
      </button>
      {ouvert && (
        <>
          {/* Un clic n'importe où ailleurs referme : sans cela le menu reste
              ouvert au-dessus de la table et masque les lignes. */}
          <div className="fixed inset-0 z-10" onMouseDown={() => setOuvert(false)} />
          <div className="absolute left-0 z-20 mt-1 min-w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {utiles.map((e) => (
              <button
                key={e.libellé}
                type="button"
                onClick={() => {
                  onChoisir(e.clés);
                  setOuvert(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                {e.libellé}{' '}
                <span className="tabular-nums text-slate-400">({e.clés.length})</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
