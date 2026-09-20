import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { tenantsApi } from '../api/tenants';
import { APP_NAME, BrandMark } from './Brand';
import { useRouterSelection } from '../routers/RouterContext';
import { REACHABILITY_LABEL } from '../api/routers';
import { SideNav } from './SideNav';

/** Le SUPER_ADMIN pilote la plateforme, pas un réseau en particulier. */

/**
 * Choix du routeur sur lequel portent les écrans. Masqué quand il n'y en a
 * qu'un : afficher un choix sans alternative n'apprend rien et encombre.
 */
function RouterSelector() {
  const { routers, current, select } = useRouterSelection();
  if (routers.length === 0) return null;

  const health = current ? REACHABILITY_LABEL[current.health.state] : null;
  const dotColor =
    health?.tone === 'green'
      ? 'bg-emerald-500'
      : health?.tone === 'red'
        ? 'bg-red-500'
        : health?.tone === 'amber'
          ? 'bg-amber-500'
          : 'bg-slate-300';

  if (routers.length === 1) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-600" title={health?.label}>
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        {current?.label}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} title={health?.label} />
      <select
        value={current?.id ?? ''}
        onChange={(e) => select(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
      >
        {routers.map((router) => (
          <option key={router.id} value={router.id}>
            {router.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();

  // Le SUPER_ADMIN n'appartient à aucun exploitant : l'appel échouerait.
  const tenant = useQuery({
    queryKey: ['tenant-me'],
    queryFn: tenantsApi.mine,
    enabled: user?.role !== 'SUPER_ADMIN',
    retry: false,
  });

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <div className="mb-6 flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-tight text-slate-900">{APP_NAME}</div>
            {/* Le réseau piloté, sous le nom du produit : sur plusieurs
                exploitants ouverts côte à côte, on sait lequel on regarde. */}
            <div className="truncate text-xs text-slate-500">
              {user?.role === 'SUPER_ADMIN' ? 'Plateforme' : tenant.data?.wifiName ?? '…'}
            </div>
          </div>
        </div>
        <SideNav role={user?.role} />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-500">
              {user?.email} — <span className="font-medium text-slate-700">{user?.role}</span>
            </div>
            <RouterSelector />
          </div>
          <button onClick={logout} className="text-sm text-slate-500 hover:text-red-600">
            Déconnexion
          </button>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
