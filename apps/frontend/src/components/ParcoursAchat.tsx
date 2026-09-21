import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hotspotApi } from '../api/hotspot';
import { useAuth } from '../auth/AuthContext';
import { useRouterSelection } from '../routers/RouterContext';
import { ApiError } from '../api/client';
import { Confirmation } from './Edition';
import { Button } from './ui';

/**
 * Un client peut-il acheter, là, maintenant ?
 *
 * Quatre choses doivent être d'accord, et elles bougent séparément :
 * l'adresse gravée dans la page du routeur, l'adresse où la console répond,
 * ce que le Walled Garden laisse passer, et l'existence d'une offre et d'une
 * puce. Un bail DHCP renouvelé pendant la nuit suffit à les faire diverger.
 *
 * **Personne ne l'apprend par ses clients.** Celui qui tape sur un bouton mort
 * conclut que le réseau ne marche pas et s'en va ; il ne téléphone pas pour
 * signaler un bouton. C'est donc ici, sur l'écran qu'on ouvre le matin, que la
 * rupture doit se voir — et se réparer, sinon on la lit sans savoir quoi en
 * faire.
 */
export function ParcoursAchat() {
  const { canWrite } = useAuth();
  const { currentId } = useRouterSelection();
  const queryClient = useQueryClient();
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [gestes, setGestes] = useState<string[] | null>(null);

  const etat = useQuery({
    queryKey: ['page-connexion-etat', currentId, ''],
    queryFn: () => hotspotApi.etatPageConnexion(currentId),
    enabled: Boolean(currentId),
    // Le diagnostic coûte cinq lectures du routeur. Une par minute suffit
    // largement pour une chose qui change quand un bail DHCP expire.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const reparer = useMutation({
    mutationFn: () => hotspotApi.reparerPageConnexion(currentId),
    onSuccess: (r) => {
      setErreur(null);
      setConfirmer(false);
      setGestes(r.gestes);
      queryClient.invalidateQueries({ queryKey: ['page-connexion-etat'] });
    },
    onError: (e) => setErreur(e instanceof ApiError ? e.message : 'Le routeur a refusé.'),
  });

  const sante = etat.data?.sante;

  if (gestes) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <strong>Parcours d&apos;achat rétabli.</strong>
        <ul className="mt-1 list-disc pl-5">
          {gestes.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>
    );
  }

  // Rien à dire quand tout marche : un bandeau permanent devient du décor, et
  // on cesse de le lire le jour où il compte.
  if (!sante || sante.operationnel) return null;

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <strong>Vos clients ne peuvent pas acheter d&apos;accès en ligne.</strong>
      <ul className="mt-1 list-disc pl-5">
        {sante.ruptures.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {erreur && <p className="mt-2 font-medium">{erreur}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Réparer ne se propose que si la console sait où elle répond : sans
            adresse déduite, le bouton ne pourrait que se tromper. */}
        {canWrite && sante.adresseActuelle && (
          <Button variant="danger" onClick={() => setConfirmer(true)}>
            Rétablir
          </Button>
        )}
        <Link to="/hotspot/page-connexion" className="font-medium underline">
          Voir la page de connexion
        </Link>
      </div>

      {confirmer && (
        <Confirmation
          titre="Rétablir le parcours d’achat ?"
          libelléConfirmer="Oui, rétablir"
          enCours={reparer.isPending}
          erreur={reparer.isError ? erreur : null}
          onAnnuler={() => {
            setErreur(null);
            setConfirmer(false);
          }}
          onConfirmer={() => reparer.mutate()}
        >
          <p>
            Trois gestes, et chacun est sauté s&apos;il n&apos;a rien à faire :
            l&apos;adresse de paiement est réglée sur{' '}
            <span className="font-mono text-xs">{sante.adresseActuelle}</span>, elle est
            ouverte dans le <strong>Walled Garden</strong> du routeur, et la page de connexion
            est <strong>republiée</strong> pour qu&apos;elle la porte.
          </p>
          <p className="mt-2">
            La page actuelle du routeur est écrasée et{' '}
            <strong>RouterOS n&apos;en garde aucune copie</strong>. La règle du Walled Garden
            ouvre ce port sur cette machine à tous les appareils connectés au Wi-Fi, même sans
            code ; elle se retire dans l&apos;onglet <em>Walled Garden</em>.
          </p>
        </Confirmation>
      )}
    </div>
  );
}
