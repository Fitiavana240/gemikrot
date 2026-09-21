import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { plansApi } from '../api/plans';
import { useAuth } from '../auth/AuthContext';
import { useCurrency } from '../api/money';
import { useRouterSelection } from '../routers/RouterContext';
import { ApiError } from '../api/client';
import { formatDuration } from '../api/user-manager';
import { Button, Card, Table } from './ui';

/**
 * Les profils du routeur en face des offres, dans les deux sens.
 *
 * Les deux listes divergeaient et rien ne le montrait : il fallait ouvrir
 * WinBox à côté de la console pour s'apercevoir qu'un profil créé à la main
 * n'était vendu nulle part, ou qu'une offre publique n'avait pas de profil.
 *
 * **Les deux sens ne coûtent pas la même chose.** Une offre sans profil est
 * un risque commercial : elle est vendable, et c'est au moment de livrer
 * qu'on découvre le manque. Un profil sans offre est de l'argent laissé de
 * côté : l'exploitant l'a créé pour vendre quelque chose, et ce quelque
 * chose n'apparaît sur aucune page.
 */
export function RapprochementProfils() {
  const { canWrite } = useAuth();
  const { format } = useCurrency();
  const { currentId } = useRouterSelection();
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);

  const requête = useQuery({
    queryKey: ['rapprochement-profils', currentId],
    queryFn: () => plansApi.rapprochement(currentId),
    retry: false,
  });

  /**
   * Pousse le profil de l'offre sur le routeur.
   *
   * C'est ce geste qui rend les deux listes identiques. Il **écrit sur le
   * routeur** — il y crée un profil User Manager — d'où le bouton nommé et
   * non un rattrapage automatique : pousser tout seul ce que l'exploitant
   * n'a pas relu reviendrait à décider à sa place de ce que son routeur
   * porte.
   */
  const pousser = useMutation({
    mutationFn: (planId: string) => plansApi.syncUserManager(planId),
    onSuccess: () => {
      setErreur(null);
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      queryClient.invalidateQueries({ queryKey: ['rapprochement-profils'] });
      queryClient.invalidateQueries({ queryKey: ['um-profiles'] });
    },
    onError: (e) => setErreur(e instanceof ApiError ? e.message : 'Erreur inconnue'),
  });

  const créer = useMutation({
    mutationFn: (profil: string) => plansApi.creerDepuisProfil(profil, currentId),
    onSuccess: () => {
      setErreur(null);
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      queryClient.invalidateQueries({ queryKey: ['rapprochement-profils'] });
    },
    onError: (e) => setErreur(e instanceof ApiError ? e.message : 'Erreur inconnue'),
  });

  // Un routeur injoignable ne doit pas alarmer : sans lecture, on ne sait
  // pas si les listes divergent, et prétendre le contraire serait pire.
  if (requête.isError) return null;

  const d = requête.data;
  /**
   * Les offres vendues au public que le routeur ne porte pas encore.
   *
   * La page de paiement les propose, le routeur n'a pas leur profil. Ce
   * n'est pas bloquant — il sera créé à la première vente en ligne — mais
   * c'est ce qui fait diverger les deux listes, et c'est ce qu'on vient
   * corriger ici.
   */
  const aPousser = (d?.offres ?? []).filter((o) => o.auPublic && !o.profilUmPresent);
  const sansOffre = d?.profilsUmSansOffre ?? [];

  if (!d || (aPousser.length === 0 && sansOffre.length === 0)) return null;

  return (
    <Card title="Le routeur et les offres ne disent pas la même chose">
      {/* La question que pose tout exploitant qui met les deux écrans côte à
          côte. Y répondre ici évite de la reposer à chaque fois. */}
      <p className="mb-3 max-w-3xl text-xs text-slate-500">
        Les deux listes <strong>ne peuvent pas coïncider entièrement</strong>, et ce n&apos;est
        pas un défaut : la page de paiement ne montre que les offres à ticket actives, un
        abonnement se vendant au comptoir. Ce qui suit est ce qui diverge{' '}
        <strong>sans raison</strong>.
      </p>
      {erreur && <p className="mb-2 text-sm text-red-700">{erreur}</p>}

      {aPousser.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 max-w-3xl text-sm text-slate-600">
            <strong>
              {aPousser.length} offre(s) sont vendues sur la page de paiement sans que le
              routeur porte leur profil.
            </strong>{' '}
            C&apos;est ce qui fait diverger les deux listes. Ce n&apos;est pas bloquant — le
            profil sera créé à la première vente en ligne — mais une génération de lot au
            comptoir, elle, échouerait.
          </p>
          <Table head={['Offre', 'Profil attendu', 'Prix', '']} colonnes={false}>
            {aPousser.map((o) => (
              <tr key={o.id}>
                <td className="px-3 py-2 font-medium">{o.nom}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">
                  {o.profilUm ?? o.profilHotspot}
                </td>
                <td className="px-3 py-2 tabular-nums">{format(Number(o.prix))}</td>
                <td className="px-3 py-2 text-right">
                  {canWrite && (
                    <Button
                      variant="secondary"
                      disabled={pousser.isPending}
                      onClick={() => pousser.mutate(o.id)}
                    >
                      {pousser.isPending ? 'Envoi…' : 'Pousser sur le routeur'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {sansOffre.length > 0 && (
        <>
          <p className="mb-2 max-w-3xl text-sm text-slate-600">
            {sansOffre.length} profil(s) User Manager existent sur le routeur sans qu&apos;aucune
            offre les vende. Ils ont été créés pour quelque chose ; en l&apos;état, ce quelque
            chose n&apos;apparaît sur aucune page.
          </p>
          <Table
            head={['Profil du routeur', 'Validité', 'Prix', 'Démarre', 'Appareils', '']}
            colonnes={false}
          >
            {sansOffre.map((p) => (
              <tr key={p.nom}>
                <td className="px-3 py-2 font-medium">{p.nom}</td>
                <td className="px-3 py-2">{formatDuration(p.validiteSecondes)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {p.prix ? format(p.prix) : <span className="text-amber-800">aucun</span>}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {p.demarre === 'assigned' ? "à l'attribution" : '1re connexion'}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-500">{p.appareils ?? 1}</td>
                <td className="px-3 py-2 text-right">
                  {canWrite && (
                    <Button
                      variant="secondary"
                      disabled={créer.isPending}
                      onClick={() => créer.mutate(p.nom)}
                    >
                      Créer l&apos;offre
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 max-w-3xl text-xs text-slate-500">
            L&apos;offre créée reprend la durée, le prix et le nombre d&apos;appareils du profil
            — les retaper serait l&apos;occasion de se tromper d&apos;un chiffre sur quelque
            chose que le routeur applique déjà. Elle naît <strong>archivée</strong> : elle
            n&apos;apparaît ni sur la page publique ni dans la vente tant que vous ne
            l&apos;avez pas relue et activée. Un profil sans prix arrive marqué « à revoir ».
            {/* Les deux gestes coexistent, et la différence tient en un mot :
                ici on prépare, là-bas on vend. Sans cette phrase, on cherche
                longtemps pourquoi l'offre créée n'apparaît chez personne. */}
            <br />
            Pour le mettre en vente tout de suite, « Afficher au tarif d&apos;abonnement »,
            dans <strong>User Manager › Profils</strong>, fait les deux d&apos;un coup.
          </p>
        </>
      )}

      {(d.profilsHotspotSansOffre.length ?? 0) > 0 && (
        <p className="mt-3 max-w-3xl text-xs text-slate-500">
          Côté HotSpot, {d.profilsHotspotSansOffre.length} profil(s) ne servent à aucune offre :{' '}
          <span className="font-mono">{d.profilsHotspotSansOffre.join(', ')}</span>. Moins
          gênant — ceux-là ne se vendent pas d&apos;eux-mêmes, et certains sont des profils de
          service du routeur.
        </p>
      )}
    </Card>
  );
}
