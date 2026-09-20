import type { ReactNode } from 'react';
import { phrasePanne } from '../api/pannes';
import { EmptyState, ErrorNote, Table, TableSkeleton } from './ui';

/**
 * Le bandeau d'une table lue en direct dont la lecture a échoué.
 *
 * Séparé de `ListeDuRouteur` parce que toutes les tables ne peuvent pas
 * prendre ce composant : certaines portent un balisage par ligne trop
 * particulier. Elles doivent quand même **dire** l'échec, et le dire pareil.
 */
export function PanneDuRouteur({
  requête,
}: {
  requête: { error?: unknown; refetch: () => unknown };
}) {
  return (
    <ErrorNote onRetry={() => requête.refetch()}>
      {phrasePanne(requête.error)} Cette table est lue en direct, elle n'a pas de copie en base.
    </ErrorNote>
  );
}

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

  if (requête.isError) return <PanneDuRouteur requête={requête} />;

  const lignes = requête.data ?? [];
  if (lignes.length === 0) return <EmptyState title={vide.titre} hint={vide.aide} />;
  return <Table head={colonnes}>{lignes.map(ligne)}</Table>;
}
