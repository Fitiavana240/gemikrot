import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  enrollmentsApi,
  OPERATION_LABEL,
  REACHABILITY_LABEL,
  routersApi,
  type ConnectionTest,
  type EnrollmentInvitation,
  type ImportReport,
} from '../api/routers';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Badge, Button, Card, FormField, Input, PageHeader, Table } from '../components/ui';
import { Modale } from '../components/Modale';
import { RaccordementAssisteModale } from '../components/RaccordementAssiste';

export function RoutersPage() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newRouterLabel, setNewRouterLabel] = useState('');
  /** Le formulaire de raccordement, ouvert ou non. */
  const [raccorder, setRaccorder] = useState(false);
  /** L'assistant automatique, ouvert ou non. */
  const [assiste, setAssiste] = useState(false);
  const [invitation, setInvitation] = useState<EnrollmentInvitation | null>(null);

  const routers = useQuery({ queryKey: ['routers'], queryFn: routersApi.list });
  const operations = useQuery({
    queryKey: ['router-operations'],
    queryFn: () => routersApi.pendingOperations(),
  });

  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Erreur inconnue');

  const testConnection = useMutation({
    mutationFn: routersApi.testConnection,
    onSuccess: (result) => { setError(null); setTest(result); },
    onError,
  });

  /**
   * Interroge d'office les routeurs dont l'état est inconnu.
   *
   * La joignabilité est tenue en mémoire par le serveur et **n'est alimentée
   * qu'en effet de bord** d'autres appels : après un redémarrage, tout le parc
   * affiche « pas encore interrogé ». C'était le cas le plus absurde de la
   * console — l'écran dont le métier est de dire si les routeurs répondent
   * était le seul à ne pas leur demander, et laissait cliquer « Tester » pour
   * une réponse qu'il pouvait aller chercher.
   *
   * Une seule fois par ouverture, et seulement pour les états inconnus : un
   * routeur déjà déclaré injoignable l'a été par une vraie tentative, la
   * répéter en boucle ne ferait qu'attendre le délai à chaque affichage.
   */
  const déjàSondés = useRef(new Set<string>());
  useEffect(() => {
    const inconnus = (routers.data ?? []).filter(
      (r) => r.health.state === 'INCONNU' && !déjàSondés.current.has(r.id),
    );
    if (inconnus.length === 0) return;

    for (const routeur of inconnus) déjàSondés.current.add(routeur.id);
    // Sans passer par la mutation : elle ouvre le panneau de résultat, qui
    // n'a de sens que pour un test demandé à la main.
    void Promise.allSettled(inconnus.map((r) => routersApi.testConnection(r.id))).then(() =>
      queryClient.invalidateQueries({ queryKey: ['routers'] }),
    );
  }, [routers.data, queryClient]);

  const runImport = useMutation({
    mutationFn: ({ id, dryRun }: { id: string; dryRun: boolean }) => routersApi.import(id, dryRun),
    onSuccess: (result) => {
      setError(null);
      setReport(result);
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError,
  });

  const drain = useMutation({
    mutationFn: routersApi.drainOperations,
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['router-operations'] });
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
    },
    onError,
  });

  const invite = useMutation({
    mutationFn: enrollmentsApi.invite,
    onSuccess: (result) => {
      setError(null);
      setInvitation(result);
      setNewRouterLabel('');
      setRaccorder(false);
      queryClient.invalidateQueries({ queryKey: ['router-enrollments'] });
    },
    onError,
  });

  /**
   * Les invitations ouvertes.
   *
   * Elles existaient côté serveur sans qu'aucun écran ne les montre : on
   * préparait un script, on quittait la page, et plus rien ne disait qu'un
   * raccordement était en cours — ni qu'une adresse de tunnel restait
   * réservée pour lui.
   */
  const enrollments = useQuery({
    queryKey: ['router-enrollments'],
    queryFn: enrollmentsApi.pending,
  });

  const annulerInvitation = useMutation({
    mutationFn: enrollmentsApi.cancel,
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['router-enrollments'] });
    },
    onError,
  });

  const pending = operations.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Routeurs"
        description="Vos équipements, leur joignabilité et leur raccordement. L'import recopie l'état du routeur en base et n'écrit jamais dessus."
      />

      {error && (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      )}

      {test && (
        <Card title="Test de connexion">
          {test.reachable ? (
            <p className="text-sm text-emerald-700">
              Joignable — {test.identity?.name}, RouterOS {test.version}, actif depuis {test.uptime}
            </p>
          ) : (
            <p className="text-sm text-red-600">Injoignable : {test.error}</p>
          )}
        </Card>
      )}

      {report && (
        <Card title={report.dryRun ? 'Import à blanc (rien écrit)' : 'Import effectué'}>
          <ul className="space-y-1 text-sm">
            <li>
              Offres : {report.plans.created} créées, {report.plans.updated} mises à jour
              {report.plans.needingPriceReview > 0 && (
                <span className="text-amber-700">
                  {' '}— {report.plans.needingPriceReview} prix à vérifier
                </span>
              )}
            </li>
            <li>
              Clients : {report.customers.created} créés, {report.customers.matched} rapprochés
            </li>
            <li>
              Abonnements : {report.subscriptions.created} créés, {report.subscriptions.updated} mis à jour
            </li>
            <li>
              Appareils : {report.devices.created} créés, {report.devices.updated} mis à jour
            </li>
            <li className="text-slate-500">
              {report.skipped.length} comptes ignorés (tickets et comptes internes)
            </li>
          </ul>
        </Card>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          {/* L'automatique en premier et en plein : c'est le chemin qui
              marche pour quelqu'un qui n'est pas informaticien. Le script
              reste offert — il est transparent, et c'est le seul recours
              quand le routeur n'est pas sur le meme reseau que la console. */}
          <Button onClick={() => setAssiste(true)}>Raccorder automatiquement</Button>
          <Button variant="secondary" onClick={() => setRaccorder(true)}>
            Préparer un script à coller
          </Button>
        </div>
      )}

      {assiste && (
        <RaccordementAssisteModale
          onFermer={() => setAssiste(false)}
          onFini={() => setAssiste(false)}
        />
      )}

      {raccorder && (
        <Modale
          titre="Raccorder un routeur"
          onFermer={() => setRaccorder(false)}
          actions={
            <Button
              onClick={() => invite.mutate(newRouterLabel.trim())}
              disabled={newRouterLabel.trim().length < 2 || invite.isPending}
            >
              {invite.isPending ? 'Préparation…' : 'Préparer le script'}
            </Button>
          }
          note={
            <>
              Le serveur ne touche <strong>jamais</strong> à votre routeur. Il prépare un
              script que vous collez dans Winbox, dans{' '}
              <span className="font-medium">New Terminal</span>. Le routeur ouvre alors
              lui-même le tunnel : rien à ouvrir chez votre fournisseur d&apos;accès.
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newRouterLabel.trim().length >= 2) invite.mutate(newRouterLabel.trim());
            }}
          >
            <FormField label="Nom du routeur">
              <Input
                value={newRouterLabel}
                onChange={(event) => setNewRouterLabel(event.target.value)}
                placeholder="Routeur Sanfily"
              />
            </FormField>
            <button type="submit" className="hidden" aria-hidden />
          </form>
        </Modale>
      )}

      {(enrollments.data ?? []).length > 0 && (
        <Card title="Raccordements en attente">
          <p className="mb-3 text-sm text-slate-600">
            Des scripts ont été préparés et n'ont pas encore été exécutés sur leur routeur.
            Chacun réserve une adresse dans le tunnel jusqu'à son échéance.
          </p>
          <Table head={['Routeur', 'Adresse du tunnel', 'Préparé le', 'Valable jusqu’à', '']}>
            {(enrollments.data ?? []).map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2 font-medium">{e.label}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.tunnelAddress}</td>
                <td className="px-3 py-2 text-slate-500">
                  {new Date(e.createdAt).toLocaleString('fr-FR')}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {new Date(e.expiresAt).toLocaleTimeString('fr-FR')}
                </td>
                <td className="px-3 py-2 text-right">
                  {canWrite && (
                    <Button
                      variant="secondary"
                      disabled={annulerInvitation.isPending}
                      onClick={() => annulerInvitation.mutate(e.id)}
                    >
                      Annuler
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          {/* Le script n'est rendu qu'à sa création : annuler puis refaire est
              la seule façon de le récupérer, et c'est voulu — il porte un mot
              de passe en clair. */}
          <p className="mt-3 text-xs text-slate-500">
            Le script n'est affiché qu'une fois, à sa préparation : il contient un mot de passe.
            Pour en obtenir un autre, annulez celui-ci et préparez-en un nouveau.
          </p>
        </Card>
      )}

      {invitation && (
        <Card title={`Script pour « ${invitation.label} »`}>
          <p className="mb-2 text-sm text-slate-600">
            Adresse attribuée dans le tunnel : <code>{invitation.tunnelAddress}</code>. Valable
            jusqu'à {new Date(invitation.expiresAt).toLocaleTimeString('fr-FR')}.
          </p>
          <p className="mb-3 text-sm text-amber-700">
            Ce script contient un mot de passe. Il n'est affiché qu'une fois : si vous quittez
            cette page, il faudra en préparer un autre.
          </p>

          {/* Le routeur appelle cette adresse. Privée, il ne la joint que
              depuis le même réseau — et l'échec est muet : les octets sortants
              montent, les entrants restent à zéro, rien ne dit pourquoi. Ce
              diagnostic a coûté une heure sur ce projet ; la console le pose
              maintenant avant, pas après. */}
          {invitation.endpointPrive && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Ce script ne vaut que sur ce réseau local.</strong> Le routeur appellera{' '}
              <code className="rounded bg-amber-100 px-1">{invitation.endpoint}</code>, qui est une
              adresse privée : un routeur situé ailleurs ne la joindra jamais, et le tunnel
              restera muet sans message d'erreur. Pour un routeur distant, renseignez l'adresse
              publique du serveur dans <code>WIREGUARD_ENDPOINT_HOST</code> avant de préparer le
              script.
            </div>
          )}
          {/* L'adresse a bougé depuis qu'elle a été configurée. Coller le
              script quand même fait appeler le routeur dans le vide — et
              l'échec est muet : « status: connecting » jusqu'à expiration, le
              terminal bloqué, les lignes suivantes avalées, et une erreur de
              syntaxe sans rapport pour seul symptôme. C'est arrivé ici, un
              bail DHCP ayant glissé de .135 à .23. */}
          {invitation.adressePerimee && (
            <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              <strong>Ne collez pas ce script : son adresse n&apos;est plus la bonne.</strong> Il
              fait appeler le routeur sur{' '}
              <code className="rounded bg-red-100 px-1">
                {invitation.adressePerimee.configuree}
              </code>
              , que cette machine ne porte plus
              {invitation.adressePerimee.actuelle && (
                <>
                  {' '}
                  — elle répond maintenant sur{' '}
                  <code className="rounded bg-red-100 px-1">
                    {invitation.adressePerimee.actuelle}
                  </code>
                </>
              )}
              .
              <p className="mt-2">
                Corrigez <code>PUBLIC_BASE_URL</code> et <code>WIREGUARD_ENDPOINT_HOST</code> dans
                le fichier <code>.env</code> du serveur, redémarrez-le, puis préparez un nouveau
                script. Le remède durable est une <strong>réservation DHCP</strong> pour cette
                machine sur le routeur : sans elle, l&apos;adresse glissera de nouveau.
              </p>
            </div>
          )}
          <pre className="max-h-80 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
            {invitation.script}
          </pre>
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              onClick={() => navigator.clipboard.writeText(invitation.script)}
            >
              Copier
            </Button>
            <Button variant="secondary" onClick={() => setInvitation(null)}>
              J'ai terminé
            </Button>
          </div>
        </Card>
      )}

      {pending.length > 0 && (
        <Card title={`${pending.length} opération(s) en attente de reprise`}>
          <p className="mb-3 text-sm text-slate-600">
            Ces écritures n'ont pas pu partir vers le routeur. Elles repartiront seules dès qu'il
            redeviendra joignable — rien n'est perdu.
          </p>
          <ul className="space-y-2 text-sm">
            {pending.map((operation) => (
              <li key={operation.id} className="flex items-start justify-between gap-3">
                <span>
                  <span className="font-medium">{OPERATION_LABEL[operation.kind]}</span>
                  <span className="text-slate-500"> — {operation.reason}</span>
                  {operation.attempts > 0 && (
                    <span className="block text-xs text-slate-400">
                      {operation.attempts} tentative(s)
                      {operation.lastError && ` — ${operation.lastError}`}
                    </span>
                  )}
                </span>
                {canWrite && (
                  <Button
                    variant="secondary"
                    onClick={() => drain.mutate(operation.routerId)}
                    disabled={drain.isPending}
                  >
                    Reprendre
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Table head={['Nom', 'Hôte', 'Port', 'TLS épinglé', 'Joignabilité', '']}>
        {routers.data?.map((router) => (
          <tr key={router.id}>
            <td className="px-3 py-2">{router.label}</td>
            <td className="px-3 py-2 font-mono text-xs">{router.host}</td>
            <td className="px-3 py-2">{router.restPort}</td>
            <td className="px-3 py-2">
              <Badge tone={router.tlsFingerprint ? 'green' : 'amber'}>
                {router.tlsFingerprint ? 'Oui' : 'Non'}
              </Badge>
            </td>
            <td className="px-3 py-2">
              <div>
                <Badge tone={REACHABILITY_LABEL[router.health.state].tone}>
                  {REACHABILITY_LABEL[router.health.state].label}
                </Badge>
                {router.health.suspended && (
                  <div className="mt-1 text-xs text-slate-500">
                    appels suspendus, reprise automatique
                  </div>
                )}
                {router.health.state !== 'JOIGNABLE' && router.health.lastErrorMessage && (
                  <div className="mt-1 max-w-xs truncate text-xs text-slate-400" title={router.health.lastErrorMessage}>
                    {router.health.lastErrorMessage}
                  </div>
                )}
              </div>
            </td>
            <td className="space-x-2 px-3 py-2 text-right">
              <Button variant="secondary" onClick={() => testConnection.mutate(router.id)}>
                Tester
              </Button>
              {canWrite && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => runImport.mutate({ id: router.id, dryRun: true })}
                  >
                    Import à blanc
                  </Button>
                  <Button onClick={() => runImport.mutate({ id: router.id, dryRun: false })}>
                    Importer
                  </Button>
                </>
              )}
            </td>
          </tr>
        ))}
      </Table>

      <p className="text-xs text-slate-500">
        L'import recopie l'état du routeur en base (offres, abonnés, appareils). Il n'écrit jamais
        sur le routeur.
      </p>
    </div>
  );
}
