import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { plansApi, type CreatePlanInput } from '../api/plans';
import { useAuth } from '../auth/AuthContext';
import { useCurrency } from '../api/money';
import { ApiError } from '../api/client';
import { Badge, Button, Card, FormField, Input, PageHeader, Select, Table, TableSkeleton } from '../components/ui';

const EMPTY_FORM: CreatePlanInput = {
  name: '',
  price: 0,
  validityDurationSeconds: 3600,
  startsWhen: 'FIRST_AUTH',
};

export function PlansPage() {
  const { canWrite } = useAuth();
  const { currency, format } = useCurrency();
  const queryClient = useQueryClient();
  const { data: plans, isLoading } = useQuery({ queryKey: ['plans'], queryFn: plansApi.list });
  const [form, setForm] = useState<CreatePlanInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: plansApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      setForm(EMPTY_FORM);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erreur inconnue'),
  });

  /**
   * Repousse l'offre vers User Manager. Utile quand quelqu'un a modifié le
   * profil directement dans WinBox : la base et le routeur ont alors divergé,
   * et c'est le routeur qui sert les clients.
   */
  const syncMutation = useMutation({
    mutationFn: plansApi.syncUserManager,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plans'] }),
  });

  const archiveMutation = useMutation({
    mutationFn: plansApi.archive,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plans'] }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate(form);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offres"
        description="Ce que vous vendez : durée, prix, débit. Une offre créée ici se retrouve sur le routeur, et sur la page de paiement de vos clients."
      />

      {canWrite && (
        <Card title="Nouvelle offre">
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <FormField label="Nom">
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </FormField>
            <FormField label={`Prix (${currency})`}>
              <Input
                type="number"
                required
                min={0}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Validité (secondes)">
              <Input
                type="number"
                required
                min={1}
                value={form.validityDurationSeconds}
                onChange={(e) => setForm({ ...form, validityDurationSeconds: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Démarre">
              <Select
                value={form.startsWhen}
                onChange={(e) => setForm({ ...form, startsWhen: e.target.value as CreatePlanInput['startsWhen'] })}
              >
                <option value="FIRST_AUTH">À la première connexion</option>
                <option value="ASSIGNED">Dès l'attribution</option>
              </Select>
            </FormField>
            <div className="col-span-2 md:col-span-4">
              {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Création…' : 'Créer l’offre'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading ? (
        <TableSkeleton columns={4} />
      ) : (
        <Table head={['Nom', 'Prix', 'Validité', 'Profil RouterOS', 'Statut', '']}>
          {plans?.map((plan) => (
            <tr key={plan.id}>
              <td className="px-3 py-2">{plan.name}</td>
              <td className="px-3 py-2">{format(plan.price)}</td>
              <td className="px-3 py-2">{Math.round(plan.validityDurationSeconds / 3600)} h</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-500">{plan.mikrotikProfileName}</td>
              <td className="px-3 py-2">
                <Badge tone={plan.status === 'ACTIVE' ? 'green' : 'slate'}>{plan.status}</Badge>
              </td>
              <td className="space-x-2 whitespace-nowrap px-3 py-2 text-right">
                {canWrite && plan.status === 'ACTIVE' && (
                  <>
                    {/* Repousser l'offre vers le routeur quand quelqu'un a
                        modifié le profil depuis WinBox : c'est le routeur qui
                        sert les clients, la base ne fait que le suivre. */}
                    <Button
                      variant="secondary"
                      disabled={syncMutation.isPending}
                      onClick={() => syncMutation.mutate(plan.id)}
                    >
                      {syncMutation.isPending ? 'Envoi…' : 'Synchroniser'}
                    </Button>
                    <Button variant="secondary" onClick={() => archiveMutation.mutate(plan.id)}>
                      Archiver
                    </Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
