import { useQuery } from '@tanstack/react-query';
import { tenantsApi } from '../api/tenants';
import { useAuth } from '../auth/AuthContext';

/**
 * Où en est l'exploitant de son abonnement à la plateforme.
 *
 * Il n'y avait rien : un compte était actif ou suspendu, et rien ne le
 * faisait payer. Découvrir la vente fermée un matin, sans avertissement,
 * serait la pire façon de l'apprendre.
 *
 * **Le bandeau dit aussi ce qui n'arrive pas**, et c'est le plus important :
 * les clients finaux gardent leur accès. Le routeur applique seul les
 * validités ; une plateforme impayée ferme la console, pas le Wi-Fi. Sans
 * cette phrase, un exploitant en retard croirait son réseau coupé et
 * appellerait ses clients pour rien.
 */

/** En deçà, l'échéance mérite d'être annoncée. Au-delà, c'est du bruit. */
const PREVENIR_JOURS = 10;

export function AbonnementPlateforme() {
  const { user } = useAuth();
  const requête = useQuery({
    queryKey: ['abonnement-plateforme'],
    queryFn: tenantsApi.monAbonnement,
    // Le SUPER_ADMIN n'est rattaché à aucun exploitant : la question n'a pas
    // de sens pour lui, et le serveur la refuserait.
    enabled: user?.role !== 'SUPER_ADMIN',
    retry: false,
  });

  const d = requête.data;
  if (!d) return null;

  // Rien à dire tant que l'échéance est lointaine : un bandeau permanent
  // devient du décor, et on cesse de le lire le jour où il compte.
  const muet =
    d.etat === 'sans-abonnement' ||
    (d.etat === 'a-jour' && (d.joursRestants ?? 99) > PREVENIR_JOURS);
  if (muet) return null;

  const ton =
    d.etat === 'expire'
      ? 'border-red-300 bg-red-50 text-red-900'
      : 'border-amber-300 bg-amber-50 text-amber-900';

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${ton}`}>
      <strong>
        {d.etat === 'expire'
          ? 'Votre abonnement à la plateforme a expiré : la vente est suspendue.'
          : d.etat === 'en-tolerance'
            ? `Votre abonnement est échu. Il vous reste ${d.joursRestants} jour(s) avant que la vente ne se ferme.`
            : `Votre abonnement arrive à échéance dans ${d.joursRestants} jour(s).`}
      </strong>{' '}
      {/* Ce qui n'arrive pas compte autant que ce qui arrive : sans cette
          phrase, un exploitant en retard croirait son réseau coupé. */}
      <span>
        Vos clients, eux, <strong>gardent leur accès</strong> : le routeur applique seul les
        validités et continue de les servir. La consultation de vos données reste ouverte —
        seules les ventes nouvelles s&apos;arrêtent.
      </span>
      {d.offre && (
        <span className="mt-1 block text-xs">
          Offre {d.offre}
          {d.maxRouteurs != null && ` · ${d.routeursUtilises}/${d.maxRouteurs} routeur(s)`}
          {d.echeance && ` · échéance ${new Date(d.echeance).toLocaleDateString('fr-FR')}`}
        </span>
      )}
    </div>
  );
}
