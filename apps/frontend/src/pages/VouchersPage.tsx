import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vouchersApi, type GenerateBatchInput } from '../api/vouchers';
import { plansApi } from '../api/plans';
import { formatDuration } from '../api/user-manager';
import { useAuth } from '../auth/AuthContext';
import { useCurrency } from '../api/money';
import { ApiError } from '../api/client';
import type { Voucher, VoucherStatus } from '../api/types';
import { Badge, Button, Card, FormField, Input, Select, Table } from '../components/ui';

type Tab = 'par-offre' | 'tous' | 'expires' | 'historique';

const STATUS_TONE: Record<VoucherStatus, 'green' | 'amber' | 'slate' | 'red'> = {
  CREATED: 'slate',
  SOLD: 'amber',
  ACTIVE: 'green',
  EXPIRED: 'slate',
  DISABLED: 'red',
  CANCELLED: 'red',
};

const STATUS_LABEL: Record<VoucherStatus, string> = {
  CREATED: 'à vendre',
  SOLD: 'vendu',
  ACTIVE: 'en cours',
  EXPIRED: 'expiré',
  DISABLED: 'désactivé',
  CANCELLED: 'annulé',
};

/** Ce que le routeur dit de l'échéance, en clair. */
function expiryLabel(voucher: Voucher): string {
  if (voucher.expiresAt) return new Date(voucher.expiresAt).toLocaleString('fr-FR');
  if (!voucher.umUsername) return 'sans échéance';
  if (voucher.umState === 'waiting') return 'pas encore utilisé';
  return '—';
}

export function VouchersPage() {
  const [tab, setTab] = useState<Tab>('par-offre');
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const reconcile = useMutation({
    mutationFn: vouchersApi.reconcile,
    onSuccess: (report) => {
      setNotice(
        `${report.examined} ticket(s) relus : ${report.expired} expiré(s), ${report.activated} passé(s) en cours` +
          (report.accessCut ? `, ${report.accessCut} accès coupé(s)` : ''),
      );
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
    },
    onError: (err) => setNotice(err instanceof ApiError ? err.message : 'Erreur inconnue'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Tickets</h1>
          <p className="mt-1 text-sm text-slate-500">
            L'échéance est tenue par le routeur : elle court à partir de la première connexion du
            client, et s'applique même cette console fermée.
          </p>
        </div>
        {canWrite && (
          <Button
            variant="secondary"
            onClick={() => reconcile.mutate()}
            disabled={reconcile.isPending}
          >
            {reconcile.isPending ? 'Lecture…' : 'Actualiser depuis le routeur'}
          </Button>
        )}
      </div>

      {notice && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-800">
          {notice}
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            ['par-offre', 'Par offre'],
            ['tous', 'Tous'],
            ['expires', 'Expirés'],
            ['historique', 'Historique HotSpot'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === value
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'par-offre' && <ByPlanTab />}
      {tab === 'tous' && <ListTab scope="um" generator />}
      {tab === 'expires' && <ExpiredTab />}
      {tab === 'historique' && <LegacyTab />}
    </div>
  );
}

// ==================== Par offre ====================

function ByPlanTab() {
  const { format } = useCurrency();
  const byPlan = useQuery({ queryKey: ['vouchers', 'by-plan'], queryFn: vouchersApi.countByPlan });

  if (byPlan.isLoading) return <p className="text-slate-500">Chargement…</p>;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {byPlan.data?.map((plan) => (
        <Card key={plan.planId}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium text-slate-900">{plan.planName}</div>
              <div className="text-sm text-slate-500">
                {format(plan.price)} · {formatDuration(plan.validityDurationSeconds)}
              </div>
            </div>
            {plan.umProfileName ? (
              <Badge tone="green">User Manager</Badge>
            ) : (
              <Badge tone="slate">non synchronisée</Badge>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {(['CREATED', 'SOLD', 'ACTIVE', 'EXPIRED', 'DISABLED', 'CANCELLED'] as const)
              .filter((status) => plan.counts[status])
              .map((status) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-slate-500">{STATUS_LABEL[status]}</span>
                  <span className="font-medium">{plan.counts[status]}</span>
                </div>
              ))}
          </div>

          <div className="mt-3 border-t border-slate-100 pt-2 text-sm">
            <span className="text-slate-500">Total</span>{' '}
            <span className="float-right font-medium">{plan.total}</span>
          </div>
        </Card>
      ))}
      {byPlan.data?.length === 0 && (
        <p className="text-slate-400">Aucune offre. Commencez par en créer une dans Offres.</p>
      )}
    </div>
  );
}

// ==================== Liste ====================

function ListTab({ scope, generator = false }: { scope?: 'um' | 'legacy'; generator?: boolean }) {
  const { canWrite } = useAuth();
  const { format } = useCurrency();
  const queryClient = useQueryClient();
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: plansApi.list });
  const [statusFilter, setStatusFilter] = useState<VoucherStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<GenerateBatchInput>({ planId: '', quantity: 10 });

  const vouchers = useQuery({
    queryKey: ['vouchers', scope, statusFilter],
    queryFn: () => vouchersApi.list({ scope, ...(statusFilter ? { status: statusFilter } : {}) }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vouchers'] });

  const generate = useMutation({
    mutationFn: vouchersApi.generateBatch,
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erreur inconnue'),
  });
  const disable = useMutation({ mutationFn: vouchersApi.disable, onSuccess: refresh });
  const cancel = useMutation({ mutationFn: vouchersApi.cancel, onSuccess: refresh });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.planId) {
      setError('Choisir une offre');
      return;
    }
    generate.mutate(form);
  }

  return (
    <div className="space-y-4">
      {canWrite && generator && (
        <Card title="Générer un lot">
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <FormField label="Offre">
              <Select
                value={form.planId}
                onChange={(e) => setForm({ ...form, planId: e.target.value })}
              >
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
              <Input
                value={form.prefix ?? ''}
                onChange={(e) => setForm({ ...form, prefix: e.target.value || undefined })}
              />
            </FormField>
            <div className="col-span-2 flex items-end md:col-span-1">
              <Button type="submit" disabled={generate.isPending} className="w-full">
                {generate.isPending ? 'Génération…' : 'Générer'}
              </Button>
            </div>
            {error && <p className="col-span-2 text-sm text-red-600 md:col-span-4">{error}</p>}
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Les comptes sont créés sur le routeur dès la génération : un ticket imprimé fonctionne
            sans qu'on ait à l'activer. Sa validité ne démarre qu'à la première connexion du
            client, un ticket invendu ne s'use donc pas.
          </p>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">Statut :</span>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as VoucherStatus | '')}
          className="w-auto"
        >
          <option value="">Tous</option>
          {(Object.keys(STATUS_LABEL) as VoucherStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <span className="text-sm text-slate-400">{vouchers.data?.length ?? 0} ticket(s)</span>
      </div>

      {vouchers.isLoading ? (
        <p className="text-slate-500">Chargement…</p>
      ) : (
        <VoucherTable
          vouchers={vouchers.data ?? []}
          format={format}
          canWrite={canWrite}
          onDisable={(id) => disable.mutate(id)}
          onCancel={(id) => cancel.mutate(id)}
        />
      )}
    </div>
  );
}

function ExpiredTab() {
  const { format } = useCurrency();
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const expired = useQuery({ queryKey: ['vouchers', 'expired'], queryFn: vouchersApi.listExpired });
  const disable = useMutation({
    mutationFn: vouchersApi.disable,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vouchers'] }),
  });

  if (expired.isLoading) return <p className="text-slate-500">Chargement…</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Statut expiré, ou échéance dépassée mais pas encore relue. Le routeur a déjà cessé de
        servir ces tickets.
      </p>
      <VoucherTable
        vouchers={expired.data ?? []}
        format={format}
        canWrite={canWrite}
        onDisable={(id) => disable.mutate(id)}
        emptyLabel="Aucun ticket expiré."
      />
    </div>
  );
}

function LegacyTab() {
  const { format } = useCurrency();
  const legacy = useQuery({
    queryKey: ['vouchers', 'legacy', ''],
    queryFn: () => vouchersApi.list({ scope: 'legacy' }),
  });

  if (legacy.isLoading) return <p className="text-slate-500">Chargement…</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Tickets d'avant la bascule, servis par le HotSpot local. Ils n'ont pas d'échéance : leur
        durée repart à zéro à chaque reconnexion du client. Ils restent en place tels quels.
      </p>
      <VoucherTable
        vouchers={legacy.data ?? []}
        format={format}
        canWrite={false}
        emptyLabel="Aucun ticket historique."
      />
    </div>
  );
}

function VoucherTable({
  vouchers,
  format,
  canWrite,
  onDisable,
  onCancel,
  emptyLabel = 'Aucun ticket.',
}: {
  vouchers: Voucher[];
  format: (value: string | number) => string;
  canWrite: boolean;
  onDisable?: (id: string) => void;
  onCancel?: (id: string) => void;
  emptyLabel?: string;
}) {
  return (
    <Table head={['Code', 'Prix', 'Statut', 'Échéance', 'Créé le', '']}>
      {vouchers.map((voucher) => (
        <tr key={voucher.id}>
          <td className="px-3 py-2 font-mono">{voucher.code}</td>
          <td className="px-3 py-2">{format(voucher.price)}</td>
          <td className="px-3 py-2">
            <Badge tone={STATUS_TONE[voucher.status]}>{STATUS_LABEL[voucher.status]}</Badge>
          </td>
          <td className="px-3 py-2 text-slate-500">{expiryLabel(voucher)}</td>
          <td className="px-3 py-2 text-slate-500">
            {new Date(voucher.createdAt).toLocaleDateString('fr-FR')}
          </td>
          <td className="space-x-2 px-3 py-2 text-right">
            {canWrite && onCancel && voucher.status === 'CREATED' && (
              <Button variant="secondary" onClick={() => onCancel(voucher.id)}>
                Annuler
              </Button>
            )}
            {canWrite && onDisable && voucher.status !== 'DISABLED' && (
              <Button variant="danger" onClick={() => onDisable(voucher.id)}>
                Couper l'accès
              </Button>
            )}
          </td>
        </tr>
      ))}
      {vouchers.length === 0 && (
        <tr>
          <td className="px-3 py-4 text-slate-400" colSpan={6}>
            {emptyLabel}
          </td>
        </tr>
      )}
    </Table>
  );
}
