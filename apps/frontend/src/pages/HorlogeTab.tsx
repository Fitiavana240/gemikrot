import { useQuery } from '@tanstack/react-query';
import { routerToolsApi, type HorlogeRouteur } from '../api/router-tools';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, TableSkeleton } from '../components/ui';

/**
 * Au-delà de deux minutes, l'écart n'est plus imputable au trajet réseau.
 *
 * La lecture elle-même prend quelques centaines de millisecondes, et les deux
 * horloges ne sont jamais parfaitement alignées. Un seuil serré ferait donc
 * crier au loup en permanence ; deux minutes laissent passer le bruit et
 * attrapent ce qui compte — une dérive réelle, ou un fuseau de travers.
 */
const ECART_INQUIETANT_MS = 120_000;

/**
 * L'instant que le routeur croit vivre, en millisecondes.
 *
 * Reconstruit à partir des trois champs plutôt que d'un horodatage tout fait :
 * RouterOS n'en fournit pas. C'est `gmtOffset` qui porte l'information utile,
 * pas le nom du fuseau — deux fuseaux différents au même décalage donnent la
 * même heure, et c'est l'heure qui décide des échéances.
 */
export function instantRouteur(h: HorlogeRouteur): number | null {
  if (!h.date || !h.time || !h.gmtOffset) return null;
  const t = Date.parse(`${h.date}T${h.time}${h.gmtOffset}`);
  return Number.isFinite(t) ? t : null;
}

/** « 3 min 12 s d'avance », « 4 s de retard ». */
function écartLisible(ms: number): string {
  const sens = ms > 0 ? 'avance' : 'retard';
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 60) return `${s} s de ${sens}`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ${s % 60} s de ${sens}`;
  return `${Math.floor(min / 60)} h ${min % 60} min de ${sens}`;
}

function Ligne({ libellé, children }: { libellé: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 border-b border-slate-100 py-2 last:border-0">
      <span className="w-52 shrink-0 text-sm text-slate-500">{libellé}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export function HorlogeTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-horloge', currentId],
    queryFn: () => routerToolsApi.horloge(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 60_000,
  });

  if (requête.isError) return <PanneDuRouteur requête={requête} />;

  const h = requête.data;
  const instant = h ? instantRouteur(h) : null;
  // Comparer à `dataUpdatedAt` et non à maintenant : la réponse est gardée en
  // cache une minute, et la mesurer contre l'heure courante inventerait un
  // écart d'une minute qui n'existe pas.
  const écart = instant != null ? instant - requête.dataUpdatedAt : null;
  const dérive = écart != null && Math.abs(écart) > ECART_INQUIETANT_MS;
  const synchronisée = h?.ntpStatus === 'synchronized';

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        L&apos;heure que tient le routeur. <strong>Toutes les échéances en dépendent</strong> :
        la fin d&apos;un forfait, la validité d&apos;un compte User Manager, la date portée sur
        une planche de tickets. Une horloge fausse ne coupe rien — elle coupe au mauvais
        moment, ce qui est plus difficile à voir.
      </p>

      {requête.isPending || !h ? (
        <Card>
          <TableSkeleton columns={2} />
        </Card>
      ) : (
        <>
          {!h.ntpEnabled && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <strong>Le recalage automatique est désactivé.</strong> Rien ne remet cette
              horloge à l&apos;heure : elle dérivera, et les forfaits expireront de plus en
              plus à côté.
            </div>
          )}

          {h.ntpEnabled && !synchronisée && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>
                Le recalage est activé mais n&apos;aboutit pas (
                <span className="font-mono text-xs">{h.ntpStatus}</span>).
              </strong>{' '}
              Le routeur garde l&apos;heure qu&apos;il avait. Si le lien montant est tombé
              après une coupure de courant, cette heure peut être franchement fausse.
            </div>
          )}

          {dérive && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <strong>
                Le routeur et cet appareil ne sont pas d&apos;accord sur l&apos;heure :{' '}
                {écartLisible(écart!)}.
              </strong>{' '}
              Soit le routeur dérive, soit son fuseau est faux — dans les deux cas les
              échéances tombent à côté. Vérifiez d&apos;abord que{' '}
              <em>cet appareil-ci</em> est bien à l&apos;heure, puis le fuseau du routeur.
            </div>
          )}

          <Card title="Heure">
            <Ligne libellé="Le routeur croit qu’il est">
              <span className="font-mono">
                {h.date} {h.time}
              </span>
            </Ligne>
            <Ligne libellé="Fuseau">
              <span className="font-mono">{h.timeZone || '—'}</span>
              <span className="ml-2 text-slate-500">décalage {h.gmtOffset || '—'}</span>
              {h.dstActive && <span className="ml-2 text-slate-500">heure d’été active</span>}
            </Ligne>
            <Ligne libellé="Écart avec cet appareil">
              {écart == null ? (
                <span className="text-slate-500">illisible</span>
              ) : (
                <>
                  <Badge tone={dérive ? 'red' : 'green'}>
                    {Math.abs(écart) < 2000 ? 'à l’heure' : écartLisible(écart)}
                  </Badge>
                  {/* Une comparaison ne vaut que ce que vaut la référence :
                      le dire évite d'envoyer quelqu'un régler un routeur
                      juste parce que son propre poste est à la dérive. */}
                  <span className="ml-2 text-xs text-slate-500">
                    en supposant cet appareil-ci à l’heure
                  </span>
                </>
              )}
            </Ligne>
            <Ligne libellé="En marche depuis">
              <span className="font-mono">{h.uptime || '—'}</span>
            </Ligne>
          </Card>

          <Card title="Recalage automatique (NTP)">
            <Ligne libellé="État">
              <Badge tone={!h.ntpEnabled ? 'red' : synchronisée ? 'green' : 'amber'}>
                {!h.ntpEnabled ? 'désactivé' : synchronisée ? 'recalée' : h.ntpStatus}
              </Badge>
            </Ligne>
            <Ligne libellé="Serveurs configurés">
              <span className="font-mono text-xs">{h.ntpServers.join(', ') || '—'}</span>
            </Ligne>
            <Ligne libellé="Serveur qui a répondu">
              <span className="font-mono text-xs">{h.ntpSyncedServer ?? '—'}</span>
              {h.ntpStratum != null && (
                <span className="ml-2 text-slate-500">strate {h.ntpStratum}</span>
              )}
            </Ligne>
            <Ligne libellé="Écart au dernier recalage">
              {h.ntpOffsetMs == null ? (
                <span className="text-slate-500">—</span>
              ) : (
                <span className="tabular-nums">{h.ntpOffsetMs} ms</span>
              )}
            </Ligne>
          </Card>

          {/* Le point que personne ne voit venir, et qui se paie en tickets
              mal expirés le lendemain d'une coupure. */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <strong>Après une coupure de courant</strong>, cette carte repart sans horloge à
            elle — RouterOS n&apos;expose aucune horloge matérielle dessus. Elle restaure la
            dernière heure connue et attend le premier recalage. Si le lien montant est
            revenu en même temps que le courant, la correction est immédiate et invisible ;
            s&apos;il tarde, le routeur travaille pendant ce temps avec une heure fausse, et{' '}
            <strong>les forfaits vendus dans cet intervalle porteront la mauvaise
            échéance</strong>.
          </div>
        </>
      )}
    </div>
  );
}
