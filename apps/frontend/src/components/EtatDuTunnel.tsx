import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { enrollmentsApi, routersApi } from '../api/routers';
import { ApiError } from '../api/client';
import { Badge, Button, Card, Table } from './ui';

/**
 * Le tunnel, vu du serveur — donc lisible quand le routeur ne répond pas.
 *
 * L'onglet **Tunnel** lit tout sur le routeur : les interfaces, les pairs, la
 * dernière poignée de main. Magnifique quand il répond, muet quand il ne
 * répond pas — c'est-à-dire précisément quand on cherche pourquoi. On tombait
 * alors sur « Le routeur n'a pas répondu », qui décrit le symptôme et jamais
 * la cause.
 *
 * Ce panneau-ci ne touche pas au routeur. Il lit la fiche et le fichier du
 * tunnel, et répond à la seule question qui compte quand plus rien ne passe :
 * **le serveur sait-il seulement où appeler ce routeur ?**
 *
 * Les trois causes, dans l'ordre où elles bloquent :
 *
 * 1. Le routeur n'a pas de nom public — le serveur ne sait pas où frapper.
 * 2. Le fichier du tunnel n'est pas indiqué au serveur.
 * 3. Le pair n'y figure pas.
 *
 * Une seule est affichée, la première : les empiler ferait relire le même
 * diagnostic trois fois, et c'est de toute façon la seule sur laquelle on
 * peut agir tout de suite.
 */

/** « il y a 3 min », plutôt qu'un horodatage à soustraire de tête. */
function depuis(quand: string | null): string {
  if (!quand) return 'jamais';
  const secondes = Math.max(0, Math.floor((Date.now() - new Date(quand).getTime()) / 1000));
  if (secondes < 90) return `il y a ${secondes} s`;
  if (secondes < 5400) return `il y a ${Math.round(secondes / 60)} min`;
  if (secondes < 172800) return `il y a ${Math.round(secondes / 3600)} h`;
  return `il y a ${Math.round(secondes / 86400)} j`;
}

export function EtatDuTunnel() {
  const requête = useQuery({
    queryKey: ['serveur-tunnel'],
    queryFn: enrollmentsApi.serveur,
    // Court : c'est l'écran qu'on regarde pendant qu'on répare, et une valeur
    // d'il y a cinq minutes ferait croire qu'une correction n'a rien donné.
    staleTime: 15_000,
    refetchInterval: 20_000,
    retry: false,
  });

  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Remettre le pair d'aplomb sans tout refaire.
   *
   * Le fichier du tunnel peut diverger de la fiche : un second raccordement
   * interrompu, un outil qui repasse derrière. La seule issue était de
   * recommencer le raccordement entier — ou d'éditer le fichier à la main,
   * ce qui a déjà coûté la clé privée du serveur.
   */
  const reecrire = useMutation({
    mutationFn: (id: string) => routersApi.reecrireLePair(id),
    onSuccess: (r) => {
      setMessage(r.message);
      queryClient.invalidateQueries({ queryKey: ['serveur-tunnel'] });
    },
    onError: (e) =>
      setMessage(e instanceof ApiError ? e.message : 'La réécriture a échoué.'),
  });

  const d = requête.data;
  if (!d || d.routeurs.length === 0) return null;

  const joignables = d.routeurs.filter((r) => r.manque === null);

  return (
    <Card title="Accès à distance">
      <p className="mb-3 text-sm text-slate-600">
        C'est <strong>ce serveur qui appelle vos routeurs</strong>, à un nom que MikroTik leur
        donne. Ce tableau se lit sans les joindre : il dit si le serveur sait où appeler, pas si
        l'appel aboutit.
      </p>

      <Table head={['Routeur', 'Appelé à', 'Pair posé', 'Dernier signe de vie', '']}>
        {d.routeurs.map((r) => (
          <tr key={r.routerId} className="align-top">
            <td className="px-3 py-2 font-medium">
              {r.label}
              <div className="font-mono text-xs font-normal text-slate-400">{r.tunnelAddress}</div>
            </td>
            <td className="px-3 py-2">
              {r.pointDAppel ? (
                <span className="font-mono text-xs">{r.pointDAppel}</span>
              ) : (
                <Badge tone="amber">aucun nom public</Badge>
              )}
            </td>
            <td className="px-3 py-2">
              <Badge tone={r.pairEcrit ? 'green' : 'red'}>{r.pairEcrit ? 'oui' : 'non'}</Badge>
            </td>
            <td className="px-3 py-2 text-slate-500">{depuis(r.lastSeenAt)}</td>
            <td className="px-3 py-2 text-right">
              <Button
                variant="secondary"
                disabled={reecrire.isPending}
                onClick={() => reecrire.mutate(r.routerId)}
              >
                Réécrire le pair
              </Button>
            </td>
          </tr>
        ))}
      </Table>

      {message && (
        <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">{message}</p>
      )}

      {/* Les trois acces que le raccordement produit. Ils existaient tous,
          mais deux n'etaient nulle part ecrits — et une adresse qu'on ne voit
          pas n'existe pas. */}
      {d.routeurs.some((r) => r.manque === null) && (
        <div className="mt-4 rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-medium text-slate-700">
            Ce que le raccordement vous donne, une fois le tunnel actif
          </p>
          <dl className="mt-2 space-y-2 text-sm">
            {d.routeurs
              .filter((r) => r.manque === null)
              .map((r) => (
                <div key={r.routerId}>
                  <dt className="font-medium text-slate-600">{r.label}</dt>
                  <dd className="mt-1 space-y-1 text-slate-600">
                    <div>
                      <span className="text-slate-400">Winbox, de n’importe où :</span>{' '}
                      <code className="rounded bg-slate-100 px-1 font-mono text-xs">
                        {r.tunnelAddress}:8291
                      </code>
                    </div>
                    <div>
                      <span className="text-slate-400">API de la console :</span>{' '}
                      <code className="rounded bg-slate-100 px-1 font-mono text-xs">
                        https://{r.tunnelAddress}:443
                      </code>
                    </div>
                  </dd>
                </div>
              ))}
          </dl>
          <p className="mt-2 text-xs text-slate-500">
            Ces adresses n’existent <strong>que dans le tunnel</strong> : elles ne répondent que
            sur cette machine, tunnel actif. Personne d’autre sur Internet ne peut les atteindre,
            et c’est le but.
          </p>
        </div>
      )}

      {d.routeurs.some((r) => r.manque) && (
        <div className="mt-3 space-y-2">
          {d.routeurs
            .filter((r) => r.manque)
            .map((r) => (
              <div
                key={r.routerId}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                <strong>{r.label}</strong> — {r.manque}
              </div>
            ))}
        </div>
      )}

      {joignables.length > 0 && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {joignables.length === d.routeurs.length
            ? 'Tout est en place côté serveur.'
            : `${joignables.length} routeur(s) en place côté serveur.`}{' '}
          Si l'un d'eux reste injoignable, c'est que le tunnel qui tourne ne connaît pas encore son
          pair : <strong>l'application WireGuard garde sa propre copie</strong> du fichier depuis
          l'import et ne le relit pas d'elle-même. Supprimez le tunnel, réimportez{' '}
          <code className="rounded bg-slate-200 px-1 text-xs">{d.fichier || 'wg0.conf'}</code>,
          activez.
        </p>
      )}
    </Card>
  );
}
