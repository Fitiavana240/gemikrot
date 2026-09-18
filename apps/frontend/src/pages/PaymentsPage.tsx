import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paymentsApi, type CreatePaymentInput } from '../api/payments';
import { customersApi } from '../api/customers';
import { plansApi } from '../api/plans';
import { vouchersApi } from '../api/vouchers';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import type { Payment, PaymentMethod } from '../api/types';
import { Badge, Button, Card, FormField, Input, Select, Table } from '../components/ui';

const EMPTY_FORM: CreatePaymentInput = { customerId: '', planId: '', amountAr: 0, method: 'CASH', reference: '' };

const STATUS_TONE = {
  PENDING: 'amber',
  VERIFIED: 'green',
  REJECTED: 'red',
  CANCELLED: 'slate',
  REFUNDED: 'slate',
} as const;

export function PaymentsPage() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const { data: payments, isLoading } = useQuery({ queryKey: ['payments'], queryFn: paymentsApi.list });
  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: plansApi.list });

  const [form, setForm] = useState<CreatePaymentInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [lastVerifiedVoucherCode, setLastVerifiedVoucherCode] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: paymentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      setForm(EMPTY_FORM);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erreur inconnue'),
  });

  const [verifyError, setVerifyError] = useState<string | null>(null);
  const verifyMutation = useMutation({
    mutationFn: paymentsApi.verify,
    onSuccess: async (payment: Payment) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      setVerifyError(null);
      if (payment.voucherId) {
        const voucher = await vouchersApi.get(payment.voucherId);
        setLastVerifiedVoucherCode(voucher.code);
      }
    },
    onError: (err) =>
      setVerifyError(
        err instanceof ApiError
          ? err.message
          : "Échec de la vérification — le routeur MikroTik est peut-être injoignable.",
      ),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => paymentsApi.reject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payments'] }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate(form);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Paiements</h1>

      {lastVerifiedVoucherCode && (
        <Card>
          <p className="text-sm text-emerald-700">
            Paiement vérifié — code voucher à transmettre au client :{' '}
            <span className="font-mono text-base font-semibold">{lastVerifiedVoucherCode}</span>
          </p>
        </Card>
      )}
      {verifyError && (
        <Card>
          <p className="text-sm text-red-600">{verifyError}</p>
        </Card>
      )}

      {canWrite && (
        <Card title="Nouveau paiement">
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <FormField label="Client">
              <Select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">— choisir —</option>
                {customers?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Offre">
              <Select
                value={form.planId}
                onChange={(e) => {
                  const plan = plans?.find((p) => p.id === e.target.value);
                  setForm({ ...form, planId: e.target.value, amountAr: plan ? Number(plan.priceAr) : form.amountAr });
                }}
              >
                <option value="">— choisir —</option>
                {plans?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Montant (Ar)">
              <Input
                type="number"
                min={0}
                value={form.amountAr}
                onChange={(e) => setForm({ ...form, amountAr: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Méthode">
              <Select
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}
              >
                <option value="CASH">Espèces</option>
                <option value="ORANGE_MONEY">Orange Money</option>
                <option value="MVOLA">MVola</option>
                <option value="AIRTEL_MONEY">Airtel Money</option>
                <option value="OTHER">Autre</option>
              </Select>
            </FormField>
            <FormField label="Référence">
              <Input required value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </FormField>
            <div className="col-span-2 md:col-span-5">
              {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Enregistrement…' : 'Enregistrer le paiement'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading ? (
        <p className="text-slate-500">Chargement…</p>
      ) : (
        <Table head={['Référence', 'Méthode', 'Montant', 'Statut', '']}>
          {payments?.map((payment) => (
            <tr key={payment.id}>
              <td className="px-3 py-2 font-mono text-xs">{payment.reference}</td>
              <td className="px-3 py-2">{payment.method}</td>
              <td className="px-3 py-2">{Number(payment.amountAr).toLocaleString('fr-FR')} Ar</td>
              <td className="px-3 py-2">
                <Badge tone={STATUS_TONE[payment.status]}>{payment.status}</Badge>
              </td>
              <td className="px-3 py-2 text-right space-x-2">
                {canWrite && payment.status === 'PENDING' && (
                  <>
                    <Button onClick={() => verifyMutation.mutate(payment.id)} disabled={verifyMutation.isPending}>
                      Vérifier
                    </Button>
                    <Button variant="secondary" onClick={() => rejectMutation.mutate(payment.id)}>
                      Rejeter
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
