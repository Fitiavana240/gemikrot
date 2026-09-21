import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../api/customers';
import { formatBytes, formatDuration } from '../api/user-manager';
import { useRouterSelection } from '../routers/RouterContext';
import { Badge, Card, EmptyRow, Table } from '../components/ui';

/**
 * Ce que le client a réellement consommé : durée et volume.
 *
 * La source est le **routeur**, jamais nos tables : lui seul voit les
 * connexions. Un client peut acheter dix tickets et n'en consommer qu'un.
 *
 * Deux sources, et l'écran dit laquelle. Les compteurs du compte sont
 * cumulés depuis sa création et ne s'effacent jamais — c'est le total juste.
 * Le journal RADIUS donne le détail, mais le routeur en efface les plus
 * anciennes : une ligne qui n'a que lui affiche un plancher, et le dit.
 *
 * Le premier essai a montré pourquoi les deux comptent : un abonné de ce
 * parc, 26 Gio au compteur, n'avait aucune session dans le journal RADIUS.
 * Se fier au seul journal aurait affiché zéro sur la fiche du plus gros
 * consommateur.
 */
export function ConsommationClient({ customerId }: { customerId: string }) {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['consommation-client', customerId, currentId],
    queryFn: () => customersApi.consommation(customerId, currentId),
    retry: false,
  });

  const d = requête.data;

  // Un routeur injoignable ne doit pas vider la fiche : le reste — tickets,
  // paiements, appareils — vient de la base et reste consultable.
  if (requête.isError) {
    return (
      <Card title="Consommation">
        <p className="text-sm text-slate-500">
          Le routeur n&apos;a pas répondu : la comptabilité RADIUS n&apos;est pas lisible pour
          l&apos;instant. Le reste de la fiche vient de la base et reste juste.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Consommation">
      {requête.isPending ? (
        <div className="h-16 animate-pulse rounded bg-slate-100" />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500">Temps connecté</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                {formatDuration(d?.dureeSecondes ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Reçu</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                {formatBytes(d?.octetsRecus ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Envoyé</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                {formatBytes(d?.octetsEnvoyes ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Sessions</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                {d?.sessions ?? 0}
              </dd>
            </div>
          </dl>

          {(d?.parCompte.length ?? 0) > 0 && (
            <div className="mt-4">
              <Table
                head={['Compte', 'Origine', 'Temps', 'Reçu', 'Envoyé', 'Dernière session']}
                colonnes={false}
              >
                {(d?.parCompte ?? []).map((c) => (
                  <tr key={c.compte}>
                    <td className="px-3 py-2 font-mono text-xs">{c.compte}</td>
                    <td className="px-3 py-2">
                      <Badge tone={c.origine === 'abonnement' ? 'green' : 'slate'}>
                        {c.origine}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatDuration(c.dureeSecondes)}
                      {/* Le « ≈ » ne porte que sur les lignes reconstituées
                          depuis le journal : mettre la même réserve sur un
                          compteur exact serait une prudence trompeuse. */}
                      {c.source === 'sessions' && (
                        <span
                          className="ml-1 text-slate-400"
                          title="Reconstitué depuis le journal RADIUS, que le routeur élague : au moins autant."
                        >
                          ≈
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">
                      {formatBytes(c.octetsRecus)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">
                      {formatBytes(c.octetsEnvoyes)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {/* Les comptes jamais utilisés restent affichés : savoir
                          qu'un ticket acheté n'a jamais servi vaut autant que
                          savoir combien un autre a consommé. */}
                      {c.derniere
                        ? new Date(c.derniere.replace(' ', 'T')).toLocaleString('fr-FR')
                        : 'jamais connecté'}
                    </td>
                  </tr>
                ))}
                {(d?.parCompte.length ?? 0) === 0 && (
                  <EmptyRow colSpan={6}>Aucun compte rattaché</EmptyRow>
                )}
              </Table>
            </div>
          )}

          <p className="mt-3 max-w-3xl text-xs text-slate-500">
            Chiffres relevés sur le <strong>routeur</strong>, qui seul voit les connexions. Les
            volumes viennent des <strong>compteurs du compte</strong>, cumulés depuis sa
            création et jamais effacés. Le nombre de sessions vient du journal RADIUS, qui ne
            garde que ses <strong>{d?.sessionsDansLeJournal ?? 0} dernières</strong> tous
            clients confondus — un compte peut donc afficher du trafic et zéro session.
            {d?.partiel && (
              <>
                {' '}
                <span className="text-amber-800">
                  Une ligne au moins n&apos;a pas de compteur et a été reconstituée depuis ce
                  journal : son total est un plancher, marqué{' '}
                  <span className="text-slate-400">≈</span>.
                </span>
              </>
            )}
          </p>
        </>
      )}
    </Card>
  );
}
