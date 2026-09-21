import { useEffect, useState, type FormEvent } from 'react';
import { Confirmation } from '../components/Edition';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tenantsApi, type UpdateTenantInput } from '../api/tenants';
import type { PaymentMethod } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { MotDePasseCard } from '../components/MotDePasseCard';
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  FormField,
  Input,
  PageHeader,
  Select,
  Table,
  TableSkeleton,
} from '../components/ui';
import { CURRENCIES, PROVIDERS } from '../lib/options';

export function SettingsPage() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  /** La puce qu'on s'apprête à supprimer, tant que ce n'est pas confirmé. */
  const [àSupprimer, setÀSupprimer] = useState<{ id: string; nom: string } | null>(null);
  const [form, setForm] = useState<UpdateTenantInput>({});
  const [account, setAccount] = useState({
    provider: 'MVOLA' as PaymentMethod,
    phoneNumber: '',
    accountName: '',
  });

  const tenant = useQuery({ queryKey: ['tenant-me'], queryFn: tenantsApi.mine });

  useEffect(() => {
    if (tenant.data) {
      setForm({
        name: tenant.data.name,
        wifiName: tenant.data.wifiName,
        domains: tenant.data.domains,
        logoUrl: tenant.data.logoUrl ?? '',
        currency: tenant.data.currency,
      });
    }
  }, [tenant.data]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['tenant-me'] });
  }
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Erreur inconnue');

  const save = useMutation({
    mutationFn: tenantsApi.update,
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });
  const addAccount = useMutation({
    mutationFn: tenantsApi.addMobileMoney,
    onSuccess: () => {
      setError(null);
      setAccount({ provider: 'MVOLA', phoneNumber: '', accountName: '' });
      refresh();
    },
    onError,
  });
  const toggleAccount = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      tenantsApi.setMobileMoneyActive(id, isActive),
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });
  const removeAccount = useMutation({
    mutationFn: tenantsApi.removeMobileMoney,
    onSuccess: () => { setError(null); setÀSupprimer(null); refresh(); },
    onError,
  });

  function handleSave(e: FormEvent) {
    e.preventDefault();
    save.mutate(form);
  }

  if (tenant.isLoading) return <TableSkeleton columns={4} />;
  if (tenant.isError) {
    return (
      <Card>
        <p className="text-sm text-slate-500">
          Votre compte n'est rattaché à aucun exploitant — cet écran concerne les comptes
          d'exploitation.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paramètres"
        description="Votre marque, vos puces Mobile Money et vos comptes. Ce que le client voit sur la page de paiement vient d'ici."
      />

      {àSupprimer && (
        <Confirmation
          titre={`Supprimer la puce « ${àSupprimer.nom} » ?`}
          libelléConfirmer="Supprimer cette puce"
          enCours={removeAccount.isPending}
          erreur={removeAccount.isError ? error : null}
          onAnnuler={() => {
            setError(null);
            setÀSupprimer(null);
          }}
          onConfirmer={() => removeAccount.mutate(àSupprimer.id)}
        >
          Ce numéro disparaît de la page de paiement de vos clients. Si c&apos;est le dernier,
          <strong> plus personne ne pourra payer en ligne</strong> : la page n&apos;aurait plus
          aucun numéro à afficher. Pour le retirer sans le perdre,{' '}
          <strong>Désactiver</strong> suffit.
        </Confirmation>
      )}

      {error && !àSupprimer && (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      )}

      <Card title="Identité du réseau">
        <form onSubmit={handleSave} className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <FormField label="Nom de l'exploitant">
            <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <FormField label="Nom du Wi-Fi (vu par les clients)">
            <Input
              value={form.wifiName ?? ''}
              onChange={(e) => setForm({ ...form, wifiName: e.target.value })}
            />
          </FormField>
          <FormField label="Devise">
            <Select
              value={form.currency ?? 'MGA'}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Domaines (séparés par des virgules)">
            <Input
              value={(form.domains ?? []).join(', ')}
              onChange={(e) =>
                setForm({
                  ...form,
                  domains: e.target.value
                    .split(',')
                    .map((d) => d.trim())
                    .filter(Boolean),
                })
              }
            />
          </FormField>
          <FormField label="URL du logo">
            <Input
              value={form.logoUrl ?? ''}
              onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
            />
          </FormField>
          <div className="col-span-2 flex items-end md:col-span-3">
            {canWrite && (
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            )}
          </div>
        </form>
      </Card>

      <Card title="Puces Mobile Money — ce que le client voit pour payer">
        <Table head={['Opérateur', 'Numéro', 'Titulaire de la puce', 'Proposée au client', '']}>
          {tenant.data?.mobileMoneyAccounts?.map((acc) => (
            <tr key={acc.id}>
              <td className="px-3 py-2">
                <Badge tone="slate">{acc.provider}</Badge>
              </td>
              <td className="px-3 py-2 font-mono">{acc.phoneNumber}</td>
              <td className="px-3 py-2">{acc.accountName}</td>
              <td className="px-3 py-2">
                {/* Desactiver plutot que supprimer : une puce retiree du
                    commerce garde ses paiements passes, qui referencent son
                    numero. */}
                <Badge tone={acc.isActive ? 'green' : 'slate'}>
                  {acc.isActive ? 'oui' : 'non'}
                </Badge>
              </td>
              <td className="space-x-2 px-3 py-2 text-right">
                {canWrite && (
                  <>
                    <Button
                      variant="secondary"
                      disabled={toggleAccount.isPending}
                      onClick={() =>
                        toggleAccount.mutate({ id: acc.id, isActive: !acc.isActive })
                      }
                    >
                      {acc.isActive ? 'Désactiver' : 'Réactiver'}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => setÀSupprimer({ id: acc.id, nom: acc.phoneNumber })}
                    >
                      Supprimer
                    </Button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!tenant.data?.mobileMoneyAccounts?.length && (
            <EmptyRow
              colSpan={5}
              hint="Le client ne saurait pas où envoyer son paiement."
            >
              Aucune puce enregistrée
            </EmptyRow>
          )}
        </Table>

        {canWrite && (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <FormField label="Opérateur">
              <Select
                value={account.provider}
                onChange={(e) => setAccount({ ...account, provider: e.target.value as PaymentMethod })}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Numéro">
              <Input
                value={account.phoneNumber}
                onChange={(e) => setAccount({ ...account, phoneNumber: e.target.value })}
              />
            </FormField>
            <FormField label="Nom du titulaire">
              <Input
                value={account.accountName}
                onChange={(e) => setAccount({ ...account, accountName: e.target.value })}
              />
            </FormField>
            <div className="flex items-end">
              <Button
                onClick={() => addAccount.mutate(account)}
                disabled={!account.phoneNumber || !account.accountName}
                className="w-full"
              >
                Ajouter
              </Button>
            </div>
          </div>
        )}
      </Card>

      <MotDePasseCard />
    </div>
  );
}
