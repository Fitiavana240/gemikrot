import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { tenantsApi } from '../api/tenants';
import { useAuth } from '../auth/AuthContext';
import { Card } from './ui';

/**
 * Les quatre pas qui séparent un compte neuf d'une première vente.
 *
 * Un exploitant qui vient de s'inscrire voit une console complète et vide.
 * Rien ne lui dit par où commencer, et l'ordre n'est pas indifférent : sans
 * routeur, une offre ne peut pas être poussée ; sans offre, aucun ticket ne
 * se génère ; sans puce, la page de paiement n'a pas de numéro à afficher.
 *
 * **Elle disparaît une fois les quatre franchis.** Un guide de démarrage qui
 * reste après le démarrage devient du décor, puis du bruit.
 */
export function MiseEnRoute() {
  const { user } = useAuth();
  const requête = useQuery({
    queryKey: ['mise-en-route'],
    queryFn: tenantsApi.miseEnRoute,
    // Le SUPER_ADMIN n'est rattaché à aucun exploitant : la question n'a pas
    // de sens pour lui, et le serveur la refuserait.
    enabled: user?.role !== 'SUPER_ADMIN',
    retry: false,
  });

  const d = requête.data;
  if (!d || d.terminée) return null;

  return (
    <Card title={`Mise en route — ${d.faites} sur ${d.étapes.length}`}>
      <ol className="space-y-2">
        {d.étapes.map((é, rang) => (
          <li key={é.clé} className="flex items-start gap-3">
            {/* Le numéro devient une coche : l'ordre compte tant que l'étape
                n'est pas faite, et ne compte plus après. */}
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                é.fait ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {é.fait ? '✓' : rang + 1}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={`text-sm font-medium ${
                    é.fait ? 'text-slate-400 line-through' : 'text-slate-800'
                  }`}
                >
                  {é.titre}
                </span>
                {/* Ce qu'on a constaté, et non ce qu'on suppose : « 3 offres
                    actives » se vérifie, « configuré » non. */}
                <span className="text-xs text-slate-500">{é.constat}</span>
              </div>
              {!é.fait && (
                <p className="mt-0.5 text-xs text-slate-600">
                  {é.aide}{' '}
                  <Link to={é.lien} className="font-medium text-sky-700 hover:underline">
                    Y aller
                  </Link>
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-slate-500">
        Chaque étape est <strong>constatée</strong>, jamais déclarée : « routeur raccordé » se
        coche parce que le routeur a répondu, pas parce qu&apos;une ligne existe. Cette carte
        disparaît d&apos;elle-même une fois les quatre franchies.
      </p>
    </Card>
  );
}
