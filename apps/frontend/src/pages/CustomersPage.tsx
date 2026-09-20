import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customersApi, telephoneAffiche, type CreateCustomerInput } from '../api/customers';
import { useAuth } from '../auth/AuthContext';
import { libellé, STATUT_SIMPLE } from '../api/libelles';
import { ApiError } from '../api/client';
import { Badge, Button, Card, FormField, Input, PageHeader, PanneDeLecture, Table, TableSkeleton } from '../components/ui';

const EMPTY_FORM: CreateCustomerInput = { name: '', phone: '' };

export function CustomersPage() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const clients = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  const customers = clients.data;
  const [form, setForm] = useState<CreateCustomerInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: customersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setForm(EMPTY_FORM);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erreur inconnue'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      enable ? customersApi.enable(id) : customersApi.disable(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers'] }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate(form);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Les personnes à qui vous vendez. Cliquez un nom pour voir sa fiche : tickets, abonnement, appareils et paiements réunis."
      />

      {canWrite && (
        <Card title="Nouveau client">
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <FormField label="Nom">
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </FormField>
            <FormField label="Téléphone">
              <Input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </FormField>
            <FormField label="Email (optionnel)">
              <Input
                type="email"
                value={form.email ?? ''}
                onChange={(e) => setForm({ ...form, email: e.target.value || undefined })}
              />
            </FormField>
            <FormField label="Adresse (optionnel)">
              <Input
                value={form.address ?? ''}
                onChange={(e) => setForm({ ...form, address: e.target.value || undefined })}
              />
            </FormField>
            <div className="col-span-2 md:col-span-4">
              {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Création…' : 'Ajouter'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {clients.isPending ? (
        <TableSkeleton columns={4} />
      ) : clients.isError ? (
        <PanneDeLecture requête={clients} quoi="les clients" />
      ) : (
        <Table head={['Nom', 'Téléphone', 'Email', 'Statut', '']}>
          {customers?.map((customer) => (
            <tr key={customer.id}>
              <td className="px-3 py-2">
                {/* Le nom ouvre la fiche : c'est le geste attendu, et il évite
                    d'ajouter une colonne d'action de plus. */}
                <Link
                  to={`/customers/${customer.id}`}
                  className="font-medium text-sky-700 hover:underline"
                >
                  {customer.name}
                </Link>
              </td>
              <td className="px-3 py-2">
                {(() => {
                  const t = telephoneAffiche(customer.phone);
                  return t.provisoire ? (
                    <span className="text-slate-400 italic">{t.texte}</span>
                  ) : (
                    t.texte
                  );
                })()}
              </td>
              <td className="px-3 py-2 text-slate-500">{customer.email ?? '—'}</td>
              <td className="px-3 py-2">
                <Badge tone={libellé(STATUT_SIMPLE, customer.status).ton}>
                  {libellé(STATUT_SIMPLE, customer.status).label}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right">
                {canWrite && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      toggleMutation.mutate({ id: customer.id, enable: customer.status === 'DISABLED' })
                    }
                  >
                    {customer.status === 'ACTIVE' ? 'Désactiver' : 'Réactiver'}
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
