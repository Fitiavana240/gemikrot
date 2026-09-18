import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vouchersApi, type GenerateBatchInput } from '../api/vouchers';
import { plansApi } from '../api/plans';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import type { VoucherStatus } from '../api/types';
import { Badge, Button, Card, FormField, Input, Select, Table } from '../components/ui';

const STATUS_TONE: Record<VoucherStatus, 'green' | 'amber' | 'slate' | 'red'> = {
  CREATED: 'slate',
  SOLD: 'amber',
  ACTIVE: 'green',
  EXPIRED: 'slate',
  DISABLED: 'red',
  CANCELLED: 'red',
};

export function VouchersPage() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: plansApi.list });
  const [statusFilter, setStatusFilter] = useState<VoucherStatus | ''>('');
  const { data: vouchers, isLoading } = useQuery({
    queryKey: ['vouchers', statusFilter],
    queryFn: () => vouchersApi.list(statusFilter ? { status: statusFilter } : {}),
  });

  const [form, setForm] = useState<GenerateBatchInput>({ planId: '', quantity: 10 });
  const [error, setError] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: vouchersApi.generateBatch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erreur inconnue'),
  });

  const disableMutation = useMutation({
    mutationFn: vouchersApi.disable,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vouchers'] }),
  });
  const cancelMutation = useMutation({
    mutationFn: vouchersApi.cancel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vouchers'] }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.planId) {
      setError('Choisir une offre');
      return;
    }
    generateMutation.mutate(form);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Vouchers</h1>

      {canWrite && (
        <Card title="Générer un lot">
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <FormField label="Offre">
              <Select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
                <option value="">— choisir —</option>
                {plans?.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Quantité">
              <Input
                type="number"
                min={1}
                max={1000}
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Préfixe (optionnel)">
              <Input value={form.prefix ?? ''} onChange={(e) => setForm({ ...form, prefix: e.target.value || undefined })} />
            </FormField>
            <div className="col-span-2 flex items-end md:col-span-1">
              <Button type="submit" disabled={generateMutation.isPending} className="w-full">
                {generateMutation.isPending ? 'Génération…' : 'Générer'}
              </Button>
            </div>
            {error && <p className="col-span-2 text-sm text-red-600 md:col-span-4">{error}</p>}
          </form>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">Filtrer par statut :</span>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as VoucherStatus | '')}
          className="w-auto"
        >
          <option value="">Tous</option>
          {Object.keys(STATUS_TONE).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <p className="text-slate-500">Chargement…</p>
      ) : (
        <Table head={['Code', 'Prix', 'Statut', 'Créé le', '']}>
          {vouchers?.map((voucher) => (
            <tr key={voucher.id}>
              <td className="px-3 py-2 font-mono">{voucher.code}</td>
              <td className="px-3 py-2">{Number(voucher.priceAr).toLocaleString('fr-FR')} Ar</td>
              <td className="px-3 py-2">
                <Badge tone={STATUS_TONE[voucher.status]}>{voucher.status}</Badge>
              </td>
              <td className="px-3 py-2 text-slate-500">{new Date(voucher.createdAt).toLocaleString('fr-FR')}</td>
              <td className="px-3 py-2 text-right space-x-2">
                {canWrite && voucher.status === 'CREATED' && (
                  <Button variant="secondary" onClick={() => cancelMutation.mutate(voucher.id)}>
                    Annuler
                  </Button>
                )}
                {canWrite && (voucher.status === 'SOLD' || voucher.status === 'ACTIVE') && (
                  <Button variant="danger" onClick={() => disableMutation.mutate(voucher.id)}>
                    Désactiver
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
