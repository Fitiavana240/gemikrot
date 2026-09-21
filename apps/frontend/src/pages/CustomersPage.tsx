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
  // Les clients importés du routeur portent un gabarit `import:<compte>` en
  // guise de numéro, faute de mieux : le routeur n'en connaît aucun.
  const sansNumero = (customers ?? []).filter((c) => telephoneAffiche(c.phone).provisoire);
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

  // Quel client est en cours de correction, et ce qu'on y saisit.
  const [édition, setÉdition] = useState<{ id: string; name: string; phone: string } | null>(
    null,
  );

  /**
   * Corriger un nom ou un numéro.
   *
   * `customersApi.update` existait et **rien ne l'appelait** : la console
   * affichait « à renseigner » sur quatorze clients sur quinze, sans offrir
   * nulle part de quoi le renseigner.
   */
  const updateMutation = useMutation({
    mutationFn: ({ id, ...champs }: { id: string; name: string; phone: string }) =>
      customersApi.update(id, champs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setÉdition(null);
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

      {/* Deux conséquences, et aucune n'est devinable depuis la colonne
          grisée « à renseigner » : on ne peut prévenir personne, et un
          paiement déclaré depuis le vrai numéro crée un SECOND client au
          lieu de se rattacher à celui-ci — la fiche publique rapproche sur
          le numéro, pas sur le nom. */}
      {sansNumero.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>
            {sansNumero.length === 1
              ? 'Un client n’a pas de numéro de téléphone.'
              : `${sansNumero.length} clients sur ${customers?.length ?? 0} n’ont pas de numéro de téléphone.`}
          </strong>{' '}
          Ils viennent du routeur, qui n’en connaît aucun. Vous ne pouvez donc ni les
          prévenir d’une échéance, ni rapprocher leur paiement :{' '}
          <strong>
            un règlement déclaré depuis leur vrai numéro créera une seconde fiche
          </strong>{' '}
          au lieu de se rattacher à celle-ci. Le bouton <em>Modifier</em> de chaque ligne
          permet de les compléter.
        </div>
      )}

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
                {édition?.id === customer.id ? (
                  <Input
                    value={édition.phone}
                    placeholder="034 00 000 00"
                    onChange={(e) => setÉdition({ ...édition, phone: e.target.value })}
                  />
                ) : (
                  (() => {
                    const t = telephoneAffiche(customer.phone);
                    return t.provisoire ? (
                      <span className="text-slate-400 italic">{t.texte}</span>
                    ) : (
                      t.texte
                    );
                  })()
                )}
              </td>
              <td className="px-3 py-2 text-slate-500">{customer.email ?? '—'}</td>
              <td className="px-3 py-2">
                <Badge tone={libellé(STATUT_SIMPLE, customer.status).ton}>
                  {libellé(STATUT_SIMPLE, customer.status).label}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right">
                {canWrite && édition?.id === customer.id && (
                  <>
                    <Button
                      disabled={updateMutation.isPending}
                      onClick={() => updateMutation.mutate(édition)}
                    >
                      {updateMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
                    </Button>
                    <Button variant="secondary" onClick={() => setÉdition(null)}>
                      Annuler
                    </Button>
                  </>
                )}
                {canWrite && édition?.id !== customer.id && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setÉdition({
                          id: customer.id,
                          name: customer.name,
                          // Le gabarit `import:` n'est pas un numéro : le
                          // proposer à la correction ferait recopier un
                          // faux plutôt que saisir le vrai.
                          phone: telephoneAffiche(customer.phone).provisoire
                            ? ''
                            : (customer.phone ?? ''),
                        })
                      }
                    >
                      Modifier
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        toggleMutation.mutate({ id: customer.id, enable: customer.status === 'DISABLED' })
                      }
                    >
                      {customer.status === 'ACTIVE' ? 'Désactiver' : 'Réactiver'}
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
