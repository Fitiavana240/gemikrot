import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { hotspotApi } from '../api/hotspot';
import { useAuth } from '../auth/AuthContext';
import { useRouterSelection } from '../routers/RouterContext';
import { ApiError } from '../api/client';
import { Confirmation } from '../components/Edition';
import { Button, Card, FormField, Input } from '../components/ui';

/**
 * La page que voit un client connecté au Wi-Fi mais pas encore à Internet.
 *
 * C'est le maillon qui manquait au parcours d'achat. Le Walled Garden
 * laissait déjà passer la page de paiement — l'entrée existe, avec le bon
 * port — mais elle était comptée à **zéro visite**, faute de lien : un client
 * sans code voyait une page qui ne lui proposait rien, et devait trouver le
 * vendeur.
 *
 * Le paiement ne demande **aucun accès Internet** : la page est servie sur le
 * réseau local, le client la joint par le Wi-Fi seul, et l'argent part par
 * Mobile Money, hors du routeur.
 */

/** Ce que le client tape : l'adresse doit lui être joignable sans Internet. */
const EXEMPLE = 'http://192.168.88.250:5173';

export function PageConnexionTab() {
  const { canWrite } = useAuth();
  const { currentId } = useRouterSelection();
  const [portail, setPortail] = useState(EXEMPLE);
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [compteRendu, setCompteRendu] = useState<string | null>(null);

  const apercu = useQuery({
    queryKey: ['page-connexion', portail],
    queryFn: () => hotspotApi.apercuPageConnexion(portail),
    enabled: portail.trim().length > 0,
    retry: false,
  });

  const publier = useMutation({
    mutationFn: () => hotspotApi.publierPageConnexion(portail, currentId),
    onSuccess: (r) => {
      setErreur(null);
      setConfirmer(false);
      setCompteRendu(`Page écrite sur le routeur : ${r.chemin}, ${r.octets} octets.`);
    },
    onError: (e) => setErreur(e instanceof ApiError ? e.message : 'Le routeur a refusé.'),
  });

  return (
    <div className="space-y-3">
      {compteRendu && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {compteRendu}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Adresse de la page de paiement">
          <Input
            value={portail}
            onChange={(e) => setPortail(e.target.value)}
            placeholder={EXEMPLE}
            className="w-80"
          />
        </FormField>
        {canWrite && (
          <Button
            variant="danger"
            disabled={apercu.isPending || apercu.isError}
            onClick={() => setConfirmer(true)}
          >
            Publier sur le routeur
          </Button>
        )}
      </div>

      {erreur && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {erreur}
        </p>
      )}

      {confirmer && (
        <Confirmation
          titre="Voulez-vous vraiment remplacer la page de connexion du routeur ?"
          libelléConfirmer="Oui, remplacer"
          enCours={publier.isPending}
          erreur={publier.isError ? erreur : null}
          onAnnuler={() => {
            setErreur(null);
            setConfirmer(false);
          }}
          onConfirmer={() => publier.mutate()}
        >
          <p>
            L&apos;ancienne page est écrasée et <strong>RouterOS n&apos;en garde aucune
            copie</strong>. Si la nouvelle est fautive, plus personne ne peut se connecter —
            ni les clients déjà payants, ni ceux qui viennent d&apos;acheter.
          </p>
          <p className="mt-2">
            Relisez l&apos;aperçu ci-dessous avant de répondre, et surtout l&apos;adresse{' '}
            <span className="font-mono text-xs">{portail}</span> : c&apos;est elle que le
            bouton « Acheter un accès » ouvrira, et elle doit être joignable{' '}
            <strong>depuis le Wi-Fi seul</strong>, sans Internet.
          </p>
        </Confirmation>
      )}

      <Card title="Aperçu — ce qui sera écrit">
        {apercu.isPending ? (
          <div className="h-32 animate-pulse rounded bg-slate-100" />
        ) : apercu.isError ? (
          <p className="text-sm text-red-700">
            {apercu.error instanceof ApiError
              ? apercu.error.message
              : "L'aperçu n'a pas pu être produit."}
          </p>
        ) : (
          <>
            <div className="mb-2 text-xs text-slate-500">
              {apercu.data?.chemin} — {apercu.data?.octets} octets
            </div>
            {/* Le rendu, pas le code : c'est ce que le client verra, et c'est
                la seule chose qu'on puisse vraiment relire. `sandbox` sans
                `allow-scripts` : la page porte du JavaScript, et rien ne
                justifie de l'exécuter dans la console. */}
            <iframe
              title="Aperçu de la page de connexion"
              sandbox=""
              srcDoc={apercu.data?.contenu ?? ''}
              className="h-96 w-full rounded-lg border border-slate-200 bg-white"
            />
          </>
        )}
      </Card>

      <p className="max-w-3xl text-xs text-slate-500">
        Cette page est servie <strong>par le routeur</strong>, pas par la console : elle reste
        affichée même si l&apos;application est arrêtée. C&apos;est pourquoi elle ne va
        chercher aucune donnée — une page de connexion ne doit avoir aucun mode de panne.
        L&apos;adresse du portail doit figurer dans le <strong>Walled Garden</strong>, faute de
        quoi le bouton mènera à une page que le client ne peut pas atteindre.
      </p>
    </div>
  );
}
