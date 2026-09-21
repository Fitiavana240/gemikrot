import { useCallback, useMemo, useState } from 'react';
import { Modale } from './Modale';

/**
 * Choisir les colonnes qu'on veut voir, comme le panneau « Columns » de WinBox.
 *
 * Les tables de cette console vont jusqu'à dix colonnes. Sur un ordinateur
 * portable au comptoir, les dernières sortent de l'écran et il faut faire
 * défiler horizontalement pour lire l'état d'un compte — alors que trois
 * colonnes de la table n'intéressent personne ce jour-là. WinBox règle ça
 * depuis toujours ; c'est la première chose qu'on cherche en arrivant ici.
 *
 * Le choix est **gardé d'une visite à l'autre**, sinon il faudrait le refaire
 * à chaque ouverture et personne ne s'en servirait deux fois.
 */

/** Sous quel nom le choix est rangé dans le navigateur. */
const PRÉFIXE = 'gemikrot.colonnes.';

/**
 * La clé tient aux **libellés**, pas au rang des colonnes.
 *
 * Une colonne ajoutée au milieu décalerait tous les rangs suivants : un choix
 * enregistré se remettrait alors sur les mauvaises colonnes, sans rien dire.
 * Les libellés, eux, ne bougent pas — et s'ils changent, le choix repart à
 * zéro, ce qui est le comportement souhaitable.
 */
function cléParDéfaut(entêtes: string[]): string {
  return entêtes.join('|');
}

function lire(clé: string): string[] {
  // Un navigateur en navigation privée, ou avec les données de site bloquées,
  // fait lever cet accès. La table doit s'afficher quand même.
  try {
    const brut = localStorage.getItem(PRÉFIXE + clé);
    const valeur: unknown = brut ? JSON.parse(brut) : null;
    return Array.isArray(valeur) ? valeur.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function écrire(clé: string, cachées: string[]): void {
  try {
    if (cachées.length === 0) localStorage.removeItem(PRÉFIXE + clé);
    else localStorage.setItem(PRÉFIXE + clé, JSON.stringify(cachées));
  } catch {
    // Le choix ne survivra pas à la visite. C'est tout ce qu'on perd.
  }
}

/**
 * Une colonne qu'on ne peut pas masquer.
 *
 * La première porte l'identité de la ligne — le nom du compte, le code du
 * ticket. Une table dont on l'a retirée ne se lit plus du tout. C'est aussi
 * elle que porte la ligne « aucun résultat », qui disparaîtrait avec.
 */
const PREMIÈRE_COLONNE = 0;

/**
 * Une colonne sans titre est une colonne d'actions : les boutons de la ligne.
 * La proposer au masquage ferait disparaître « Modifier » et « Supprimer »
 * sans qu'on comprenne pourquoi.
 */
function masquable(libellé: string, rang: number): boolean {
  return rang !== PREMIÈRE_COLONNE && libellé.trim() !== '';
}

export function useColonnes(entêtes: string[], clé?: string) {
  const nom = clé ?? cléParDéfaut(entêtes);
  const [cachées, setCachées] = useState<string[]>(() => lire(nom));

  const basculer = useCallback(
    (libellé: string) =>
      setCachées((avant) => {
        const après = avant.includes(libellé)
          ? avant.filter((l) => l !== libellé)
          : [...avant, libellé];
        écrire(nom, après);
        return après;
      }),
    [nom],
  );

  const toutMontrer = useCallback(() => {
    écrire(nom, []);
    setCachées([]);
  }, [nom]);

  // Les rangs, et non les libellés : c'est par le rang que la table masque à
  // la fois l'en-tête et la cellule correspondante de chaque ligne.
  const masquées = useMemo(() => {
    const rangs = new Set<number>();
    entêtes.forEach((libellé, rang) => {
      if (cachées.includes(libellé) && masquable(libellé, rang)) rangs.add(rang);
    });
    return rangs;
  }, [entêtes, cachées]);

  const réglables = useMemo(() => entêtes.filter(masquable), [entêtes]);

  return { masquées, cachées, basculer, toutMontrer, réglables };
}

/**
 * Le bouton et son panneau. Discret : il ne doit pas concurrencer du regard
 * les actions de l'écran, seulement être là quand on le cherche.
 */
export function BoutonColonnes({
  réglables,
  cachées,
  basculer,
  toutMontrer,
}: {
  réglables: string[];
  cachées: string[];
  basculer: (libellé: string) => void;
  toutMontrer: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const nbCachées = réglables.filter((l) => cachées.includes(l)).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        Colonnes
        {nbCachées > 0 && (
          <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
            {réglables.length - nbCachées + 1}/{réglables.length + 1}
          </span>
        )}
      </button>

      {ouvert && (
        <Modale
          titre="Colonnes affichées"
          onFermer={() => setOuvert(false)}
          actions={
            nbCachées > 0 ? (
              <button
                type="button"
                onClick={toutMontrer}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Tout afficher
              </button>
            ) : undefined
          }
          note={
            <>
              Le choix est gardé sur cet appareil, et vaut pour cette table
              uniquement. Masquer une colonne ne masque rien sur le routeur : elle est
              seulement retirée de l&apos;affichage.
            </>
          }
        >
          <div className="space-y-1">
            {réglables.map((libellé) => (
              <label
                key={libellé}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={!cachées.includes(libellé)}
                  onChange={() => basculer(libellé)}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span className="text-slate-700">{libellé}</span>
              </label>
            ))}
          </div>
        </Modale>
      )}
    </>
  );
}
