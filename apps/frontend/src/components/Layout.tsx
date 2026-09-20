import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { tenantsApi } from '../api/tenants';
import { getTenantCible, setTenantCible } from '../api/client';
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

/**
 * L'exploitant qu'un SUPER_ADMIN pilote.
 *
 * Il n'appartient à aucun exploitant : tant qu'il n'en cible pas un, toute
 * action qui crée une ligne échoue — le serveur ne saurait à qui la
 * rattacher. Le laisser découvrir cela en cliquant sur « Générer » était le
 * défaut ; le choix se fait maintenant ici, une fois.
 *
 * Invisible pour les autres comptes, dont le jeton porte déjà l'exploitant.
 */
function SelecteurExploitant() {
  const { user } = useAuth();
  const [cible, setCible] = useState(getTenantCible);

  const exploitants = useQuery({
    queryKey: ['tenants-cibles'],
    queryFn: tenantsApi.list,
    enabled: user?.role === 'SUPER_ADMIN',
    retry: false,
  });

  // Un identifiant retenu qui ne correspond plus à rien scoperait la console
  // sur un exploitant inexistant : écrans vides sans explication. On le
  // relâche dès que la liste le dément.
  useEffect(() => {
    if (!exploitants.data || !cible) return;
    if (!exploitants.data.some((t) => t.id === cible)) {
      setTenantCible(null);
      setCible(null);
      window.location.reload();
    }
  }, [exploitants.data, cible]);

  if (user?.role !== 'SUPER_ADMIN') return null;

  const liste = exploitants.data ?? [];
  if (exploitants.isError || liste.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <select
        value={cible ?? ''}
        onChange={(e) => {
          const valeur = e.target.value || null;
          setTenantCible(valeur);
          setCible(valeur);
          // Rechargement plutôt qu'invalidation : l'exploitant change le
          // sens de *toutes* les données en cache, pas d'une requête.
          window.location.reload();
        }}
        className={`rounded-md border px-2 py-1 text-sm focus:border-sky-500 focus:outline-none ${
          cible
            ? 'border-slate-300 bg-white text-slate-700'
            : 'border-amber-400 bg-amber-50 text-amber-800'
        }`}
        title="L'exploitant sur lequel portent les actions"
      >
        <option value="">Aucun exploitant ciblé</option>
        {liste.map((t) => (
          <option key={t.id} value={t.id}>
            {t.wifiName || t.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();

  const [ouvert, setOuvert] = useState(false);
  const { pathname } = useLocation();

  // Refermer en changeant d'écran : sur téléphone, le menu recouvre le
  // contenu, et le laisser ouvert masquerait la page qu'on vient d'ouvrir.
  useEffect(() => setOuvert(false), [pathname]);

  // Le SUPER_ADMIN n'appartient à aucun exploitant : l'appel échouerait.
  const tenant = useQuery({
    queryKey: ['tenant-me'],
    queryFn: tenantsApi.mine,
    enabled: user?.role !== 'SUPER_ADMIN',
    retry: false,
  });

  const marque = (
    <div className="flex items-center gap-2.5">
      <BrandMark className="h-8 w-8 shrink-0" />
      <div className="min-w-0 leading-tight">
        <div className="text-base font-semibold tracking-tight text-slate-900">{APP_NAME}</div>
        {/* Le réseau piloté, sous le nom du produit : sur plusieurs
            exploitants ouverts côte à côte, on sait lequel on regarde. */}
        <div className="truncate text-xs text-slate-500">
          {user?.role === 'SUPER_ADMIN' ? 'Plateforme' : tenant.data?.wifiName ?? '…'}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/*
        Sous 1024 px, la barre latérale sort du flux et se pose par-dessus.
        À 224 px de large, la laisser en place mangeait la moitié d'un écran
        de téléphone et poussait les tableaux hors champ — la console devenait
        inutilisable au comptoir, là où on s'en sert le plus.
      */}
      {ouvert && (
        <button
          type="button"
          aria-label="Fermer le menu"
          onClick={() => setOuvert(false)}
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
        />
      )}

      {/*
        `lg:sticky` et non `lg:static` : en statique, la barre s'étirait sur
        toute la hauteur du document — 33 000 px sur la table des 646 comptes —
        et son `overflow-y-auto` n'entrait jamais en jeu. À mi-page, la
        navigation avait disparu vers le haut, et il fallait tout remonter
        pour changer d'écran. Collée à `h-screen`, elle reste et défile chez
        elle quand ses groupes dépassent.
      */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          ouvert ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-6">{marque}</div>
        <SideNav role={user?.role} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Collée elle aussi : elle porte le sélecteur de routeur et la
          déconnexion, les deux seules commandes dont on peut avoir besoin au
          milieu d'une longue table. Sous le tiroir (z-40) et son voile
          (z-30), pour ne pas passer par-dessus sur téléphone.
        */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Ouvrir le menu"
              aria-expanded={ouvert}
              onClick={() => setOuvert(true)}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 lg:hidden"
            >
              {/* Trois traits : le seul symbole de menu qu'on reconnaisse
                  sans l'avoir appris. */}
              <span aria-hidden className="block h-px w-4 bg-current" />
              <span aria-hidden className="mt-1 block h-px w-4 bg-current" />
              <span aria-hidden className="mt-1 block h-px w-4 bg-current" />
            </button>
            {/* L'adresse et le rôle disparaissent d'abord : ce sont les
                informations les moins utiles au travail courant. */}
            <div className="hidden min-w-0 truncate text-sm text-slate-500 sm:block">
              {user?.email} — <span className="font-medium text-slate-700">{user?.role}</span>
            </div>
            <SelecteurExploitant />
            <RouterSelector />
          </div>
          <button
            onClick={logout}
            className="shrink-0 text-sm text-slate-500 hover:text-red-600"
          >
            Déconnexion
          </button>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
