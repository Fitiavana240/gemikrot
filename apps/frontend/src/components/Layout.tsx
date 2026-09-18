import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/plans', label: 'Offres' },
  { to: '/customers', label: 'Clients' },
  { to: '/vouchers', label: 'Vouchers' },
  { to: '/payments', label: 'Paiements' },
];

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <div className="mb-6 text-lg font-semibold text-sky-700">Zone WIFI-TATI</div>
        <nav className="space-y-1">
          {NAV.map((item) => (
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
