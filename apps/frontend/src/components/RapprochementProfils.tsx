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
  const casse = (d?.offres ?? []).filter(
    (o) => o.auPublic && !o.profilHotspotPresent && !o.profilUmPresent,
  );
  const sansOffre = d?.profilsUmSansOffre ?? [];

  if (!d || (casse.length === 0 && sansOffre.length === 0)) return null;

  return (
    <Card title="Le routeur et les offres ne disent pas la même chose">
      {erreur && <p className="mb-2 text-sm text-red-700">{erreur}</p>}

      {casse.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <strong>
            {casse.length} offre(s) vendue(s) au public n&apos;ont aucun profil sur le routeur.
          </strong>{' '}
          Le profil manquant sera créé à la première vente en ligne — mais une génération de
          lot au comptoir, elle, échouera. Les noms :{' '}
          <span className="font-mono text-xs">{casse.map((o) => o.nom).join(', ')}</span>.
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
