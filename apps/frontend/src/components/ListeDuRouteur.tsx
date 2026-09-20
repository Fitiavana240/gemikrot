import type { ReactNode } from 'react';
import { phrasePanne } from '../api/pannes';
import { EmptyState, ErrorNote, Table, TableSkeleton } from './ui';

/**
 * Table lue en direct sur le routeur : attente, panne, vide, puis contenu.
 *
 * Elle existait en deux exemplaires identiques, un par écran de configuration
 * MikroTik. Deux copies veulent dire deux endroits où corriger une phrase, et
 * c'est exactement ce qui est arrivé : les deux disaient « Le routeur n'a pas
 * répondu » pour n'importe quel échec, y compris pour un routeur qui avait
 * parfaitement répondu et refusé nos identifiants.
 *
 * Le message de vide et celui de panne ne se ressemblent pas par hasard :
 * **une table vide et une table en échec se confondent à l'œil**, et c'est la
 * confusion la plus coûteuse ici — « aucun client connecté » et « je n'ai pas
 * pu regarder » appellent des gestes opposés.
 */
export function ListeDuRouteur<T>({
  requête,
  colonnes,
  vide,
  ligne,
}: {
  requête: {
    isPending: boolean;
    isError: boolean;
    error?: unknown;
    data?: T[];
    refetch: () => unknown;
  };
  colonnes: string[];
  vide: { titre: string; aide?: string };
  ligne: (item: T, index: number) => ReactNode;
}) {
  if (requête.isPending) return <TableSkeleton columns={colonnes.length} />;

  if (requête.isError) {
    return (
      <ErrorNote onRetry={() => requête.refetch()}>
        {phrasePanne(requête.error)} Cette table est lue en direct, elle n'a pas de copie en base.
      </ErrorNote>
    );
  }

  const lignes = requête.data ?? [];
  if (lignes.length === 0) return <EmptyState title={vide.titre} hint={vide.aide} />;
  return <Table head={colonnes}>{lignes.map(ligne)}</Table>;
}

/**
 * Un décompte, affiché seulement s'il a été lu.
 *
 * « 0 compte(s) » était écrit sans condition, à côté d'une table en échec :
 * la longueur d'un tableau vide faute de réponse. Le routeur en portait 646.
 * C'est la même confusion que la table blanche, en pire — un chiffre a l'air
 * d'un constat.
 */
export function Compteur({
  requête,
  nombre,
  unité,
}: {
  requête: { isPending: boolean; isError: boolean };
  nombre: number;
  unité: string;
}) {
  if (requête.isPending) return null;
  const texte = requête.isError ? `${unité} : non lu` : `${nombre} ${unité}`;
  return <span className="shrink-0 text-sm text-slate-500">{texte}</span>;
}
