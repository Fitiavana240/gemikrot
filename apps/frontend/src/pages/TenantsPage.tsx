import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tenantsApi, type Tenant, type TenantStatus } from '../api/tenants';
import { ApiError } from '../api/client';
import { Badge, Button, Card, PageHeader, Table, TableSkeleton } from '../components/ui';
import { Confirmation } from '../components/Edition';
import { Modale } from '../components/Modale';
import { FormField, Input } from '../components/ui';

/** Propres a cet ecran : « en attente » ne veut rien dire ailleurs. */
const STATUT_EXPLOITANT: Record<TenantStatus, { label: string; ton: 'green' | 'amber' | 'red' }> = {
  ACTIVE: { label: 'actif', ton: 'green' },
  PENDING: { label: 'en attente de validation', ton: 'amber' },
  SUSPENDED: { label: 'suspendu', ton: 'red' },
};

/** Réservé au SUPER_ADMIN : validation et suivi des exploitants. */
export function TenantsPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  /** L'exploitant qu'on s'apprête à suspendre, tant que ce n'est pas confirmé. */
  const [àSuspendre, setÀSuspendre] = useState<{ id: string; name: string } | null>(null);
  /** L'exploitant dont on règle l'abonnement, tant que la fenêtre est ouverte. */
  const [abonnementDe, setAbonnementDe] = useState<Tenant | null>(null);
  const [offre, setOffre] = useState('');
  const [maxRouteurs, setMaxRouteurs] = useState('');
  const [echeance, setEcheance] = useState('');
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: tenantsApi.list });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tenants'] });
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Erreur inconnue');

  const activate = useMutation({
    mutationFn: tenantsApi.activate,
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });
  const suspend = useMutation({
    mutationFn: tenantsApi.suspend,
    onSuccess: () => { setError(null); setÀSuspendre(null); refresh(); },
    onError,
  });

  const definirAbonnement = useMutation({
    mutationFn: (t: Tenant) =>
      tenantsApi.definirAbonnement(t.id, {
        platformPlanName: offre.trim() || null,
        // Une chaîne vide vaut « sans limite », pas « zéro routeur » : le
        // second empêcherait d'en raccorder un seul.
        maxRouters: maxRouteurs.trim() === '' ? null : Number(maxRouteurs),
        platformEndsAt: echeance || null,
      }),
    onSuccess: () => {
      setError(null);
      setAbonnementDe(null);
      refresh();
    },
    onError,
  });

  const ouvrirAbonnement = (t: Tenant) => {
    setOffre(t.platformPlanName ?? '');
    setMaxRouteurs(t.maxRouters == null ? '' : String(t.maxRouters));
    setEcheance(t.platformEndsAt ? t.platformEndsAt.slice(0, 10) : '');
    setAbonnementDe(t);
  };

  const pending = tenants.data?.filter((t) => t.status === 'PENDING') ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exploitants"
        description="Les réseaux Wi-Fi hébergés par la plateforme. Un compte inscrit reste bloqué tant qu'il n'est pas activé ici."
      />

      {abonnementDe && (
        <Modale
          titre={`Abonnement de « ${abonnementDe.name} »`}
          onFermer={() => setAbonnementDe(null)}
          actions={
            <Button
              disabled={definirAbonnement.isPending}
              onClick={() => definirAbonnement.mutate(abonnementDe)}
            >
              {definirAbonnement.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          }
          note={
            <>
              Passé l&apos;échéance, une <strong>tolérance de quinze jours</strong> court avant
              que la vente ne se ferme — une console qui se ferme le jour même d&apos;un retard
              de virement ferait perdre des ventes pour rien. Et même après, la consultation
              reste ouverte et <strong>les clients finaux gardent leur accès</strong> : le
              routeur applique seul les validités. On ferme la console, pas le Wi-Fi. Une
              échéance vide ne bloque jamais rien.
            </>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Offre">
              <Input
                value={offre}
                placeholder="Standard"
                onChange={(e) => setOffre(e.target.value)}
              />
            </FormField>
            <FormField label="Routeurs autorisés">
              <Input
                type="number"
                min={1}
                value={maxRouteurs}
                placeholder="sans limite"
                onChange={(e) => setMaxRouteurs(e.target.value)}
              />
            </FormField>
            <FormField label="Échéance">
              <Input
                type="date"
                value={echeance}
                onChange={(e) => setEcheance(e.target.value)}
              />
            </FormField>
          </div>
        </Modale>
      )}

      {àSuspendre && (
        <Confirmation
          titre={`Suspendre l’exploitant « ${àSuspendre.name} » ?`}
          libelléConfirmer="Suspendre cet exploitant"
          enCours={suspend.isPending}
          erreur={suspend.isError ? error : null}
          onAnnuler={() => {
            setError(null);
            setÀSuspendre(null);
          }}
          onConfirmer={() => suspend.mutate(àSuspendre.id)}
        >
          Ses comptes ne pourront plus entrer dans la console. Ce n&apos;est pas une
          suppression : rien n&apos;est effacé et <strong>Activer</strong> rétablit tout.
        </Confirmation>
      )}

      {error && !àSuspendre && (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      )}

      {pending.length > 0 && (
        <Card title={`${pending.length} inscription(s) en attente de votre validation`}>
          <p className="text-sm text-slate-600">
            Un exploitant en attente ne peut pas se connecter tant que vous ne l'avez pas activé.
          </p>
        </Card>
      )}

      {tenants.isLoading ? (
        <TableSkeleton columns={4} />
      ) : (
        <Table head={['Exploitant', 'Réseau Wi-Fi', 'Devise', 'Abonnement', 'Statut', '']}>
          {tenants.data?.map((tenant) => (
            <tr key={tenant.id}>
              <td className="px-3 py-2">{tenant.name}</td>
              <td className="px-3 py-2">{tenant.wifiName}</td>
              <td className="px-3 py-2">{tenant.currency}</td>
              <td className="px-3 py-2 text-xs">
                {/* Les domaines ont cédé la place : savoir ce qu'un exploitant
                    paie et jusqu'à quand se demande bien plus souvent que la
                    liste de ses domaines, qui se lit dans ses paramètres. */}
                {tenant.platformPlanName ? (
                  <>
                    <span className="font-medium text-slate-700">{tenant.platformPlanName}</span>
                    {tenant.maxRouters != null && (
                      <span className="text-slate-500"> · {tenant.maxRouters} routeur(s)</span>
                    )}
                    {tenant.platformEndsAt && (
                      <div
                        className={
                          new Date(tenant.platformEndsAt) < new Date()
                            ? 'text-red-700'
                            : 'text-slate-500'
                        }
                      >
                        jusqu'au {new Date(tenant.platformEndsAt).toLocaleDateString('fr-FR')}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-slate-400">aucun</span>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge tone={STATUT_EXPLOITANT[tenant.status].ton}>
                  {STATUT_EXPLOITANT[tenant.status].label}
                </Badge>
              </td>
              <td className="space-x-2 px-3 py-2 text-right">
                <Button variant="secondary" onClick={() => ouvrirAbonnement(tenant)}>
                  Abonnement
                </Button>
                {tenant.status !== 'ACTIVE' ? (
                  <Button onClick={() => activate.mutate(tenant.id)}>Activer</Button>
                ) : (
                  // Un clic coupait tout un réseau : la console de
                  // l'exploitant et le service de ses clients.
                  <Button
                    variant="danger"
                    onClick={() => setÀSuspendre({ id: tenant.id, name: tenant.name })}
                  >
                    Suspendre
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
