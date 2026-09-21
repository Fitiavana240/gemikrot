import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vouchersApi, type ReconcileReport } from '../api/vouchers';
import { STATUT_TICKET } from '../api/libelles';
import { ApiError } from '../api/client';
import { Badge, Button, Card, Table } from '../components/ui';

/**
 * Confronter les tickets de la base à ce que porte le routeur.
 *
 * La vérification existait côté serveur — `POST /vouchers/reconcile` — et
 * **aucun écran ne l'appelait**. Elle était donc écrite, testée, et
 * injoignable : le seul moyen de savoir qu'un ticket n'ouvrait rien était de
 * le vendre.
 *
 * Relevé sur ce parc au moment de brancher cet écran : les seize tickets
 * encore vivants de la base, dont un marqué vendu, ne correspondaient à
 * aucun compte du routeur. Les comptes User Manager qu'ils désignaient
 * avaient été supprimés depuis WinBox ; la base ne l'avait jamais su.
 */
export function RapprochementTab() {
  const queryClient = useQueryClient();
  const [rapport, setRapport] = useState<ReconcileReport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const tickets = useQuery({ queryKey: ['vouchers'], queryFn: () => vouchersApi.list() });

  const lancer = useMutation({
    mutationFn: vouchersApi.reconcile,
    onSuccess: (r) => {
      setRapport(r);
      setErreur(null);
      // La réconciliation écrit : elle marque les expirations et coupe des
      // accès. Ce que les autres écrans affichent n'est plus à jour.
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (e: unknown) =>
      setErreur(e instanceof ApiError ? e.message : 'Erreur inconnue'),
  });

  const parCode = new Map((tickets.data ?? []).map((v) => [v.code, v]));

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Confronte les tickets enregistrés ici aux comptes que porte réellement le routeur.
        <strong> C&apos;est le routeur qui fait foi</strong> : un ticket que la base croit
        vendable, mais dont le compte a été supprimé depuis WinBox, n&apos;ouvrira rien —
        et rien d&apos;autre ne le dit.
      </p>

      <Card title="Vérifier maintenant">
        <p className="mb-3 max-w-3xl text-sm text-slate-600">
          La vérification lit le routeur, puis met la base à jour : elle marque les tickets
          arrivés à échéance et coupe les accès correspondants.{' '}
          <strong>Elle ne crée ni ne supprime aucun compte.</strong>
        </p>
        <Button disabled={lancer.isPending} onClick={() => lancer.mutate()}>
          {lancer.isPending ? 'Vérification…' : 'Vérifier sur le routeur'}
        </Button>

        {erreur && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {erreur}
          </p>
        )}
      </Card>

      {rapport && (
        <>
          {rapport.sansCompte.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <strong>
                {rapport.sansCompte.length === 1
                  ? 'Un ticket ne correspond à aucun compte sur le routeur.'
                  : `${rapport.sansCompte.length} tickets ne correspondent à aucun compte sur le routeur.`}
              </strong>{' '}
              Ils n&apos;ouvriront rien. Un ticket déjà vendu dans cette liste veut dire
              qu&apos;un client a payé pour un code qui ne marche pas —{' '}
              <strong>c&apos;est celui-là qu&apos;il faut traiter en premier</strong>.
            </div>
          )}

          <Card title="Ce que la vérification a fait">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {(
                [
                  ['Examinés', rapport.examined],
                  ['Arrivés à échéance', rapport.expired],
                  ['Activés', rapport.activated],
                  ['Accès coupés', rapport.accessCut],
                  ['Remis à plus tard', rapport.deferred],
                ] as const
              ).map(([libellé, valeur]) => (
                <div key={libellé} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="text-xs text-slate-500">{libellé}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums">{valeur}</div>
                </div>
              ))}
            </div>
            {rapport.deferred > 0 && (
              <p className="mt-3 max-w-3xl text-sm text-amber-800">
                {rapport.deferred} opération(s) n&apos;ont pas pu être appliquées et attendent
                que le routeur redevienne joignable.
              </p>
            )}
          </Card>

          {rapport.sansCompte.length > 0 && (
            <Card title={`${rapport.sansCompte.length} ticket(s) sans compte`}>
              <Table head={['Code', 'Statut en base', 'Ce que cela veut dire']}>
                {rapport.sansCompte.map((code) => {
                  const v = parCode.get(code);
                  const vendu = v?.status === 'SOLD';
                  return (
                    <tr key={code} className={vendu ? 'bg-red-50/60' : undefined}>
                      <td className="px-3 py-2 font-mono text-xs font-medium">{code}</td>
                      <td className="px-3 py-2">
                        {v ? (
                          <Badge tone={vendu ? 'red' : 'slate'}>
                            {STATUT_TICKET[v.status]?.label ?? v.status}
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {vendu ? (
                          <span className="font-medium text-red-800">
                            Payé par un client, et n&apos;ouvre rien. À rembourser ou à
                            remplacer.
                          </span>
                        ) : (
                          <span className="text-slate-600">
                            Invendable : rien ne l&apos;authentifiera sur le routeur.
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
              {/* Aucun bouton de purge. Supprimer ces lignes effacerait la
                  trace d'un ticket vendu sans contrepartie, qui est
                  précisément ce qu'il faut garder pour rembourser. */}
              <p className="mt-3 max-w-3xl text-xs text-slate-500">
                Rien n&apos;est supprimé ici : la trace d&apos;un ticket vendu sans
                contrepartie est ce qui permet de rembourser le client.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
