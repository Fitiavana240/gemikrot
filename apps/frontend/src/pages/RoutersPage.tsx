import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  OPERATION_LABEL,
  REACHABILITY_LABEL,
  routersApi,
  type ConnectionTest,
  type ImportReport,
} from '../api/routers';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Badge, Button, Card, Table } from '../components/ui';

export function RoutersPage() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const pending = operations.data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Routeurs</h1>

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
