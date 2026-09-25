import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * Ce qui demande une décision, sous une cloche.
 *
 * L'information existait déjà — sur le tableau de bord, dans Paiements, dans
 * Abonnements — mais il fallait ouvrir le bon écran pour la trouver. Un
 * exploitant qui passe sa journée sur l'écran Tickets ne voyait pas qu'un
 * client a payé il y a trois jours et attend toujours son code.
 *
 * **Le compte ne montre que ce qui n'a pas été écarté.** Une pastille qui ne
 * retombe jamais à zéro cesse d'être lue au bout d'une semaine, et c'est
 * précisément la semaine où quelque chose arrive.
 */

export interface Notification {
  cle: string;
  gravite: 'urgent' | 'attention' | 'info';
  titre: string;
  detail: string;
  lien: string;
  lue: boolean;
}

/**
 * La gravite, dite par une pastille et un fond -- et non par un onglet.
 *
 * Une bordure coloree de quatre pixels sur le cote d'une ligne est la marque
 * la plus reconnaissable des interfaces fabriquees a la chaine, et elle ne
 * porte rien que ces deux-la ne portent mieux : la pastille se voit a
 * l'endroit ou l'oeil arrive, au debut du titre, la ou la bordure vit au bord
 * du panneau, la ou il ne va pas.
 *
 * **Deux indices plutot qu'un.** La couleur seule laisse de cote qui la
 * distingue mal ; la pastille ajoute une position et une forme, et le fond
 * teinte la ligne entiere.
 */
const TON: Record<Notification['gravite'], { fond: string; pastille: string }> = {
  urgent: { fond: 'bg-red-50', pastille: 'bg-red-500' },
  attention: { fond: 'bg-amber-50', pastille: 'bg-amber-500' },
  info: { fond: 'bg-white', pastille: 'bg-slate-300' },
};

export function Notifications() {
  const [ouvert, setOuvert] = useState(false);
  const panneau = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const liste = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<Notification[]>('/notifications'),
    // Une minute : ces comptes changent quand un client paie ou qu'une
    // échéance tombe, pas à la seconde. Aucune lecture du routeur ici.
    refetchInterval: 60_000,
    retry: false,
  });

  const ecarter = useMutation({
    mutationFn: (cle: string) => api.post<{ ok: true }>('/notifications/lue', { cle }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  /**
   * Fermer en cliquant ailleurs, et à l'échappement.
   *
   * Un panneau qui ne se ferme qu'en recliquant sur la cloche reste ouvert
   * par-dessus ce qu'on voulait lire dès qu'on a cliqué à côté.
   */
  useEffect(() => {
    if (!ouvert) return;
    const auClic = (e: MouseEvent) => {
      if (panneau.current && !panneau.current.contains(e.target as Node)) setOuvert(false);
    };
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(false);
    };
    document.addEventListener('mousedown', auClic);
    document.addEventListener('keydown', auClavier);
    return () => {
      document.removeEventListener('mousedown', auClic);
      document.removeEventListener('keydown', auClavier);
    };
  }, [ouvert]);

  const notifications = liste.data ?? [];
  const aVoir = notifications.filter((n) => !n.lue);
  const urgentes = aVoir.some((n) => n.gravite === 'urgent');

  return (
    <div className="relative" ref={panneau}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-label={
          aVoir.length > 0 ? `${aVoir.length} notification(s) à voir` : 'Notifications'
        }
        aria-expanded={ouvert}
        className="relative rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {aVoir.length > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${
              urgentes ? 'bg-red-600' : 'bg-amber-500'
            }`}
          >
            {aVoir.length}
          </span>
        )}
      </button>

      {ouvert && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-medium text-slate-800">
            À traiter
          </div>

          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              {liste.isPending ? 'Lecture…' : 'Rien ne demande de décision.'}
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
              {notifications.map((n) => (
                <li
                  key={n.cle}
                  className={`px-4 py-3 ${n.lue ? 'bg-white opacity-60' : TON[n.gravite].fond}`}
                >
                  <div className="flex items-start gap-2.5">
                    {/* `mt-1.5` aligne la pastille sur la premiere ligne du
                        titre, et non sur le bloc : un titre qui passe sur
                        deux lignes la laisserait flotter au milieu. */}
                    <span
                      aria-hidden
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        n.lue ? 'bg-slate-300' : TON[n.gravite].pastille
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={n.lien}
                        onClick={() => setOuvert(false)}
                        className="block text-sm font-medium text-slate-900 hover:underline"
                      >
                        {n.titre}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-600">{n.detail}</p>
                      {/* Écarter ne résout rien et ne le prétend pas : c'est
                          « j'ai vu », et la ligne reste lisible en dessous. */}
                      {!n.lue && (
                        <button
                          type="button"
                          onClick={() => ecarter.mutate(n.cle)}
                          className="mt-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline"
                        >
                          J&apos;ai vu
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
