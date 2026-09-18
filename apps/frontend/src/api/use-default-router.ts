import { useQuery } from '@tanstack/react-query';
import { routersApi } from './routers';

/**
 * Un seul site est déployé aujourd'hui : les écrans ciblent le premier
 * routeur enregistré. Quand d'autres sites arriveront (via le VPN), ce hook
 * sera remplacé par un sélecteur de routeur dans la barre latérale.
 */
export function useDefaultRouter() {
  const query = useQuery({ queryKey: ['routers'], queryFn: routersApi.list });
  return { router: query.data?.[0], isLoading: query.isLoading, error: query.error };
}
