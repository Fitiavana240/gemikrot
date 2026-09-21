import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/dashboard';
import { useRouterSelection } from '../routers/RouterContext';
import { Badge, Card } from './ui';

/**
 * À quelle heure le réseau se remplit, et de combien il peut se remplir.
 *
 * Deux choses qu'on ne devine pas de tête : l'heure où les gens arrivent —
 * elle décide quand brider — et le plafond qu'ils finiront par atteindre —
 * il décide quand agrandir.
 *
 * **La source est courte, et c'est dit.** RouterOS ne garde qu'un nombre
 * limité de sessions RADIUS puis les efface : le profil ne vaut que ce que
 * vaut cet échantillon. Taire sa taille ferait lire une statistique là où il
 * n'y a qu'une indication.
 */

/** En deçà, le profil ne raconte rien de fiable et l'écran doit le dire. */
const ÉCHANTILLON_MAIGRE = 50;

/** Au-delà, la pointe touche le plafond du bassin d'adresses. */
const OCCUPATION_TENDUE = 0.8;

export function Occupation() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['occupation', currentId],
    queryFn: () => dashboardApi.occupation(currentId),
    enabled: Boolean(currentId),
    retry: false,
  });

  const d = requête.data;
  if (requête.isError) return null;

  const plusHaut = Math.max(1, ...(d?.parHeure ?? []).map((t) => t.max));
  const heurePointe = d?.pointe ? new Date(d.pointe.quand).getHours() : null;

  return (
    <Card title="À quelle heure le réseau se remplit">
      {requête.isPending ? (
        <div className="h-24 animate-pulse rounded bg-slate-100" />
      ) : d && d.sessions === 0 ? (
        <p className="text-sm text-slate-500">
          Le routeur ne garde aucune session dans son journal RADIUS : il n&apos;y a rien à
          profiler pour l&apos;instant.
        </p>
      ) : (
        <>
          <div className="flex items-end gap-0.5">
            {(d?.parHeure ?? []).map((t) => (
              <div key={t.heure} className="group relative flex flex-1 flex-col items-center">
                {/* Deux hauteurs superposées : le maximum observé en clair,
                    la moyenne en plein. Le seul maximum ferait croire à une
                    affluence permanente ; la seule moyenne masquerait la
                    pointe, qui est ce qui sature. */}
                <div
                  className="flex w-full flex-col justify-end rounded-t bg-sky-100"
                  style={{ height: `${Math.max(2, (t.max / plusHaut) * 72)}px` }}
                  title={`${t.heure} h — jusqu’à ${t.max} session(s), ${t.moyenne} en moyenne`}
                >
                  <div
                    className={`w-full rounded-t ${
                      t.heure === heurePointe ? 'bg-amber-500' : 'bg-sky-500'
                    }`}
                    style={{ height: `${(t.moyenne / plusHaut) * 72}px` }}
                  />
                </div>
                <span className="mt-1 text-[10px] tabular-nums text-slate-400">
                  {t.heure % 6 === 0 ? t.heure : ''}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            {d?.pointe && (
              <span>
                Pointe :{' '}
                <strong className="tabular-nums">{d.pointe.sessions} connectés</strong> vers{' '}
                <strong>{heurePointe} h</strong>
                <span className="ml-1.5 text-slate-500">
                  ({new Date(d.pointe.quand).toLocaleDateString('fr-FR', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'short',
                  })})
                </span>
              </span>
            )}
            {d?.plafondClients != null && (
              <span className="text-slate-600">
                Plafond du bassin : <strong className="tabular-nums">{d.plafondClients}</strong>{' '}
                clients
              </span>
            )}
            {d?.occupationPointe != null && (
              <Badge tone={d.occupationPointe >= OCCUPATION_TENDUE ? 'amber' : 'green'}>
                {Math.round(d.occupationPointe * 100)} % à la pointe
              </Badge>
            )}
          </div>

          {/* La taille de l'échantillon, toujours. Sans elle, vingt sessions
              se lisent comme un mois de mesures. */}
          <p className="mt-2 text-xs text-slate-500">
            Calculé sur <strong>{d?.sessions ?? 0} session(s)</strong> gardées par le routeur,
            couvrant {d?.joursCouverts ?? 0} jour(s).{' '}
            {(d?.sessions ?? 0) < ÉCHANTILLON_MAIGRE && (
              <span className="text-amber-800">
                C&apos;est peu : RouterOS efface les plus anciennes, et le profil n&apos;est
                pour l&apos;instant qu&apos;une indication.
              </span>
            )}{' '}
            Une session compte dans <strong>toutes</strong> les heures qu&apos;elle traverse —
            sinon les longues, celles qui saturent, disparaîtraient du calcul.
          </p>
        </>
      )}
    </Card>
  );
}
