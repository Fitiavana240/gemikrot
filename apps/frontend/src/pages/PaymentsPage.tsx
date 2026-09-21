import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paymentsApi, PAYMENT_STATUS, type CreatePaymentInput } from '../api/payments';
import { customersApi } from '../api/customers';
import { plansApi } from '../api/plans';
import { vouchersApi } from '../api/vouchers';
import { useAuth } from '../auth/AuthContext';
import { méthodePaiement } from '../api/libelles';
import { useCurrency } from '../api/money';
import { ApiError } from '../api/client';
import type { Payment, PaymentMethod } from '../api/types';
import { Badge, Button, Card, FormField, Input, PageHeader, PanneDeLecture, Select, Table, TableSkeleton } from '../components/ui';

const EMPTY_FORM: CreatePaymentInput = { customerId: '', planId: '', amount: 0, method: 'CASH', reference: '' };

/**
 * Au-delà d'une journée, un paiement en attente cesse d'être une file et
 * devient un problème : le client a envoyé l'argent et n'a rien reçu.
 */
const ATTENTE_TROP_LONGUE_MS = 24 * 3_600_000;

/** « aujourd'hui », « hier », « il y a 3 j ». */
function depuis(iso: string): string {
  const jours = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return 'hier';
  return `il y a ${jours} j`;
}

function attendDepuisTropLongtemps(paiement: { status: string; createdAt: string }): boolean {
  return (
    paiement.status === 'PENDING' &&
    Date.now() - new Date(paiement.createdAt).getTime() > ATTENTE_TROP_LONGUE_MS
  );
}

export function PaymentsPage() {
  const { canWrite } = useAuth();
  const { currency, format } = useCurrency();
  const queryClient = useQueryClient();
  const règlements = useQuery({ queryKey: ['payments'], queryFn: paymentsApi.list });
  const payments = règlements.data;
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
      <PageHeader
        title="Paiements"
        description="Les encaissements, et ceux qui attendent une validation. Valider un paiement ouvre l'accès du client."
      />

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
                  setForm({ ...form, planId: e.target.value, amount: plan ? Number(plan.price) : form.amount });
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
            <FormField label={`Montant (${currency})`}>
              <Input
                type="number"
                min={0}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
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

      {règlements.isPending ? (
        <TableSkeleton columns={4} />
      ) : règlements.isError ? (
        <PanneDeLecture requête={règlements} quoi="les paiements" />
      ) : (
        <Table head={['Référence', 'Déclaré', 'Méthode', 'Montant', 'Statut', '']}>
          {payments?.map((payment) => (
            <tr key={payment.id} className={attendDepuisTropLongtemps(payment) ? 'bg-amber-50/60' : undefined}>
              <td className="px-3 py-2 font-mono text-xs">{payment.reference}</td>
              {/* La table ne portait aucune date : un paiement déclaré il y a
                  cinq minutes et un autre qui attend depuis trois jours s'y
                  lisaient pareil. Or un paiement en attente, c'est un client
                  qui a payé et n'a rien reçu — le temps est l'information. */}
              <td className="px-3 py-2 text-xs text-slate-500">
                {new Date(payment.createdAt).toLocaleDateString('fr-FR')}
                <span
                  className={`ml-1.5 ${
                    attendDepuisTropLongtemps(payment) ? 'font-medium text-amber-800' : ''
                  }`}
                >
                  {depuis(payment.createdAt)}
                </span>
              </td>
              <td className="px-3 py-2">{méthodePaiement(payment.method)}</td>
              <td className="px-3 py-2">{format(payment.amount)}</td>
              <td className="px-3 py-2">
                <Badge tone={PAYMENT_STATUS[payment.status].tone}>
                  {PAYMENT_STATUS[payment.status].label}
                </Badge>
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
