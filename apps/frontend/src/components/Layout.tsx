import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { tenantsApi } from '../api/tenants';
import { APP_NAME, BrandMark } from './Brand';

const NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/sessions', label: 'Appareils actifs' },
  { to: '/subscriptions', label: 'Abonnements' },
  { to: '/devices', label: 'Appareils' },
  { to: '/plans', label: 'Offres' },
  { to: '/customers', label: 'Clients' },
  { to: '/vouchers', label: 'Tickets' },
  { to: '/ticket-print', label: 'Imprimer' },
  { to: '/ticket-templates', label: 'Modèles de ticket' },
  { to: '/payments', label: 'Paiements' },
  { to: '/routers', label: 'Routeurs' },
  { to: '/hotspot', label: 'HotSpot' },
  { to: '/user-manager', label: 'User Manager' },
  { to: '/settings', label: 'Paramètres' },
];

/** Le SUPER_ADMIN pilote la plateforme, pas un réseau en particulier. */
const SUPER_ADMIN_NAV: typeof NAV = [{ to: '/tenants', label: 'Exploitants' }];

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
        <nav className="space-y-1">
          {[...NAV, ...(user?.role === 'SUPER_ADMIN' ? SUPER_ADMIN_NAV : [])].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-50'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="text-sm text-slate-500">
            {user?.email} — <span className="font-medium text-slate-700">{user?.role}</span>
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
