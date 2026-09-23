import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { tenantsApi } from '../api/tenants';
import { useAuth } from '../auth/AuthContext';
import { AbonnementCorps } from '../pages/AbonnementPage';
import { PageHeader } from './ui';

/**
 * Le mur qui s'interpose quand l'abonnement à la plateforme a expiré.
 *
 * Le bandeau ne suffisait pas. Un bandeau se lit une fois puis devient du
 * décor : l'exploitant découvrait la vente fermée en cliquant sur
 * « Générer », au comptoir, devant un client qui attend. Le mur le lui dit à
 * l'ouverture de la console, avec les tarifs et l'adresse où payer.
 *
 * **Il ne ferme jamais la lecture.** C'est la règle posée depuis le début —
 * fermer la consultation reviendrait à prendre ses données en otage pour une
 * facture. Le lien « Consulter mes données » lève donc le mur pour la durée
 * de l'onglet, et le bandeau reprend le relais sur chaque écran. Les boutons
 * qui écrivent, eux, restent refusés par le serveur : ce n'est pas l'écran
 * qui garde la porte.
 *
 * **Ni pour le SUPER_ADMIN, ni sur la page d'abonnement elle-même.** Le
 * premier n'appartient à aucun exploitant et n'a donc pas d'échéance ; la
 * seconde est précisément ce qu'on veut atteindre.
 */

/** Le choix ne vit que le temps de l'onglet : le mur revient au rechargement. */
const CLE_LECTURE = 'gemikrot_abonnement_lecture';

function lectureDemandee(): boolean {
  try {
    return sessionStorage.getItem(CLE_LECTURE) === '1';
  } catch {
    return false;
  }
}

/** Les écrans que le mur laisse passer quoi qu'il arrive. */
const TOUJOURS_OUVERT = ['/abonnement', '/settings'];

export function MurAbonnement({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const demandeLecture = params.get('lecture') === '1';

  const abonnement = useQuery({
    queryKey: ['abonnement-plateforme'],
    queryFn: tenantsApi.monAbonnement,
    // Le SUPER_ADMIN n'est rattaché à aucun exploitant : le serveur refuserait.
    enabled: user?.role !== 'SUPER_ADMIN',
    retry: false,
  });

  // Le paramètre est une commande, pas un état : on le retient puis on nettoie
  // l'adresse, sinon il resterait collé aux liens qu'on partage.
  useEffect(() => {
    if (!demandeLecture) return;
    try {
      sessionStorage.setItem(CLE_LECTURE, '1');
    } catch {
      /* stockage indisponible : le mur reviendra, ce n'est pas grave */
    }
    params.delete('lecture');
    setParams(params, { replace: true });
  }, [demandeLecture, params, setParams]);

  const bloque =
    abonnement.data?.etat === 'expire' &&
    !demandeLecture &&
    !lectureDemandee() &&
    !TOUJOURS_OUVERT.some((chemin) => pathname.startsWith(chemin));

  if (!bloque) return <>{children}</>;

  /**
   * Le superviseur voit le mur, pas la facture.
   *
   * Il doit savoir pourquoi la vente ne marche plus — sinon il croit la
   * console cassée et s'acharne devant un client qui attend. Mais le montant
   * dû et l'adresse où payer ne le concernent pas : ce n'est pas lui qui
   * règle, et lui montrer la note de son employeur n'aide personne.
   */
  if (user?.role !== 'ADMIN' && user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="space-y-4">
        <PageHeader
          title="La vente est suspendue"
          description="L'abonnement de ce réseau à la plateforme a expiré."
        />
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">
            Prévenez l&apos;administrateur de votre réseau : lui seul peut régler
            l&apos;abonnement.
          </p>
          <p className="mt-2">
            Vos clients, eux, <strong>gardent leur accès</strong> : le routeur applique seul les
            validités et continue de les servir. Rien n&apos;est coupé sur le Wi-Fi.
          </p>
        </div>
        <p className="text-sm text-slate-600">
          <Link to="/?lecture=1" className="font-medium text-sky-700 hover:underline">
            Consulter les données en lecture seule
          </Link>{' '}
          — clients, recettes et historique restent accessibles.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Votre abonnement a expiré"
        description="La vente est suspendue. Vos clients, eux, gardent leur accès."
      />
      <AbonnementCorps mur />
    </div>
  );
}
