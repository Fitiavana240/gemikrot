import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { routersApi, type RouterView } from '../api/routers';
import { useAuth } from '../auth/AuthContext';

const STORAGE_KEY = 'gemikrot_router_id';

interface RouterContextValue {
  routers: RouterView[];
  /** Routeur sur lequel portent les écrans. `null` tant que la liste charge. */
  current: RouterView | null;
  /** À passer en `?routerId=` sur les appels qui visent un routeur. */
  currentId: string | undefined;
  select: (routerId: string) => void;
  isLoading: boolean;
}

const RouterSelectionContext = createContext<RouterContextValue | null>(null);

/**
 * Routeur courant de la console.
 *
 * Sans lui, tout retombe sur « le plus ancien routeur enregistré » : une
 * hypothèse invisible qui rendait la console mono-routeur quoi qu'en dise le
 * modèle de données. Le choix est mémorisé par navigateur — l'exploitant qui
 * gère deux sites ne veut pas le refaire à chaque écran.
 */
export function RouterProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const routers = useQuery({
    queryKey: ['routers'],
    queryFn: routersApi.list,
    // Le SUPER_ADMIN n'appartient à aucun exploitant : il n'a pas de routeurs.
    enabled: isAuthenticated && user?.role !== 'SUPER_ADMIN',
    retry: false,
  });

  const list = useMemo(() => routers.data ?? [], [routers.data]);

  // Le routeur mémorisé peut avoir été supprimé depuis : on retombe sur le
  // premier de la liste plutôt que de laisser les écrans sans cible.
  const current = useMemo(() => {
    if (list.length === 0) return null;
    return list.find((router) => router.id === selectedId) ?? list[0];
  }, [list, selectedId]);

  useEffect(() => {
    if (!current) return;
    try {
      localStorage.setItem(STORAGE_KEY, current.id);
    } catch {
      /* stockage indisponible : le choix vivra le temps de l'onglet */
    }
  }, [current]);

  const value = useMemo<RouterContextValue>(
    () => ({
      routers: list,
      current,
      // `undefined` et non le premier identifiant : le backend retombe alors
      // sur son propre défaut, ce qui garde les appels valides pendant le
      // chargement de la liste.
      currentId: current?.id,
      select: setSelectedId,
      isLoading: routers.isLoading,
    }),
    [list, current, routers.isLoading],
  );

  return (
    <RouterSelectionContext.Provider value={value}>{children}</RouterSelectionContext.Provider>
  );
}

export function useRouterSelection(): RouterContextValue {
  const context = useContext(RouterSelectionContext);
  if (!context) {
    throw new Error('useRouterSelection doit être utilisé sous <RouterProvider>');
  }
  return context;
}

/** Suffixe de requête à concaténer : `''` quand aucun routeur n'est choisi. */
export function routerQuery(routerId: string | undefined, separator: '?' | '&' = '?'): string {
  return routerId ? `${separator}routerId=${encodeURIComponent(routerId)}` : '';
}
