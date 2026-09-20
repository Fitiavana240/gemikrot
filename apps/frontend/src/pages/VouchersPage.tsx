import { useParams } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vouchersApi, type GenerateBatchInput } from '../api/vouchers';
import { plansApi } from '../api/plans';
import { formatDuration } from '../api/user-manager';
import { useAuth } from '../auth/AuthContext';
import { libellé, STATUT_TICKET } from '../api/libelles';
import { TabBar, type TabDef } from '../components/TabBar';
import { userManagerApi } from '../api/user-manager';
import { BatchesPage } from './BatchesPage';
import { TicketPrintPage } from './TicketTemplatesPage';
import { useRouterSelection } from '../routers/RouterContext';
import { useCurrency } from '../api/money';
import { ApiError } from '../api/client';
import type { Plan, Voucher, VoucherStatus } from '../api/types';
import {
  Badge,
  Button,
  Card,
  Compteur,
  EmptyRow,
  FormField,
  Input,
  PageHeader,
  PanneDeLecture,
  Select,
  Table,
  TableSkeleton,
} from '../components/ui';

/**
 * Un onglet par façon de regarder les tickets, plus les deux écrans qui les
 * accompagnent. Les regrouper ici plutôt que de les éparpiller dans le menu :
 * générer, suivre le lot et imprimer sont trois moments de la même tâche.
 */
const ONGLETS = {
  'par-offre': { titre: 'Par offre', rendu: () => <ByPlanTab /> },
  tous: { titre: 'Tous', rendu: () => <ListTab generator /> },
  expires: { titre: 'Expirés', rendu: () => <ExpiredTab /> },
  lots: { titre: 'Lots', rendu: () => <BatchesPage /> },
  impression: { titre: 'Imprimer', rendu: () => <TicketPrintPage /> },
  historique: { titre: 'Historique HotSpot', rendu: () => <ListTab scope="legacy" /> },
} as const;

const BARRE: TabDef[] = Object.entries(ONGLETS).map(([to, { titre }]) => ({ to, label: titre }));

type Tab = keyof typeof ONGLETS;

/**
 * Les statuts viennent de `libelles.ts`, comme sur les autres écrans.
 *
 * Cet écran gardait ses propres tables, et elles avaient déjà divergé : un
 * ticket coupé s'y lisait « désactivé », un ticket annulé y était rouge. Or
 * le rouge veut dire « quelque chose à faire », et une annulation ne demande
 * rien. C'est l'écran le plus consulté de la console.
 */
const STATUTS = Object.keys(STATUT_TICKET) as VoucherStatus[];

/** Ce que le routeur dit de l'échéance, en clair. */
function expiryLabel(voucher: Voucher): string {
  if (voucher.expiresAt) return new Date(voucher.expiresAt).toLocaleString('fr-FR');
  if (!voucher.umUsername) return 'sans échéance';
  if (voucher.umState === 'waiting') return 'pas encore utilisé';
  return '—';
}

export function VouchersPage() {
  const { tab } = useParams();
  const courant: Tab = tab && tab in ONGLETS ? (tab as Tab) : 'par-offre';
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
    <div className="space-y-5">
      <PageHeader
        title="Tickets"
        description="Les accès vendus à l'unité. L'échéance est tenue par le routeur : elle court à partir de la première connexion du client, et s'applique même cette console fermée."
        actions={
          canWrite && (
            <Button
              variant="secondary"
              onClick={() => reconcile.mutate()}
              disabled={reconcile.isPending}
            >
              {reconcile.isPending ? 'Lecture…' : 'Actualiser depuis le routeur'}
            </Button>
          )
        }
      />

      {notice && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-800">
          {notice}
        </div>
      )}

      <TabBar base="/vouchers" tabs={BARRE} />
      {ONGLETS[courant].rendu()}
    </div>
  );
}

// ==================== Par offre ====================

function ByPlanTab() {
  const { format } = useCurrency();
  const byPlan = useQuery({ queryKey: ['vouchers', 'by-plan'], queryFn: vouchersApi.countByPlan });

  if (byPlan.isLoading) return <TableSkeleton columns={4} />;
  // Sans ce cas, une lecture en échec rendait la grille vide, et le message
  // « Aucune offre » ne s'affichait pas non plus — une page blanche qui
  // invitait à recréer des offres qui existent.
  if (byPlan.isError) return <PanneDeLecture requête={byPlan} quoi="les tickets par offre" />;

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
                  <span className="text-slate-500">{libellé(STATUT_TICKET, status).label}</span>
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

/**
 * Ce que la génération va réellement faire, dit avant de la lancer.
 *
 * Deux questions qu'un exploitant doit pouvoir se poser : **où** les comptes
 * seront créés, et **sous quel profil**. User Manager est le choix par
 * défaut, seul capable de faire expirer une validité calendaire. Le HotSpot
 * reste possible — pour un routeur sans le paquet, ou pour les tickets courts
 * que le parc vend déjà ainsi — mais le même chiffre n'y veut pas dire la
 * même chose : le plafond compte le temps *connecté*, pas les jours. L'écran
 * l'écrit en heures avant de générer, au lieu de le supposer connu.
 *
 * Le profil est vérifié sur le routeur, pas seulement lu en base : une offre
 * dont le profil a été renommé dans WinBox produirait des comptes orphelins,
 * et l'erreur n'apparaîtrait qu'à la première connexion d'un client.
 */
function CibleGeneration({
  plan,
  cible,
}: {
  plan: Plan | undefined;
  cible: 'USER_MANAGER' | 'HOTSPOT';
}) {
  const { currentId } = useRouterSelection();
  const profils = useQuery({
    queryKey: ['um-profiles-check', currentId],
    queryFn: () => userManagerApi.listProfiles(currentId),
    enabled: Boolean(plan) && cible === 'USER_MANAGER',
    retry: false,
  });

  if (!plan) {
    return (
      <p className="text-xs text-slate-500">
        Choisissez une offre pour voir où les comptes seront créés.
      </p>
    );
  }

  const hotspot = cible === 'HOTSPOT';

  // Les deux tables ont leurs propres profils, et ils ne portent pas le même
  // nom : User Manager refuse des caractères que le HotSpot accepte. Afficher
  // le profil HotSpot en cible User Manager envoyait chercher dans la
  // mauvaise table — et faisait échouer le contrôle d'existence par-dessus.
  const attendu = hotspot ? plan.mikrotikProfileName : plan.umProfileName;
  const trouvé = attendu ? profils.data?.some((p) => p.name === attendu) : undefined;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <span>
          <span className="text-slate-500">Créés dans </span>
          <Badge tone={hotspot ? 'amber' : 'green'}>
            {hotspot ? 'HotSpot' : 'User Manager'}
          </Badge>
        </span>
        <span>
          <span className="text-slate-500">Profil {hotspot ? 'HotSpot' : 'User Manager'} </span>
          {attendu ? (
            <span className="font-mono text-xs">{attendu}</span>
          ) : (
            // Le nom exact est dérivé côté serveur, pas ici : le recopier
            // ferait deux règles qui divergeraient au premier changement.
            <span className="text-slate-400">pas encore lié</span>
          )}
        </span>
        <span>
          {/* Le même chiffre ne veut pas dire la même chose des deux côtés :
              calendaire sur User Manager, temps connecté sur le HotSpot.
              L'écrire évite de vendre un mois pour 720 h de connexion. */}
          <span className="text-slate-500">{hotspot ? 'Plafond ' : 'Validité '}</span>
          {formatDuration(plan.validityDurationSeconds)}
          <span className="text-slate-500">{hotspot ? ' de temps connecté' : ' calendaire'}</span>
        </span>
      </div>

      {hotspot && (
        <p className="mt-1.5 text-xs text-amber-700">
          Sur le HotSpot, rien n'expire à une date : le plafond compte le temps passé connecté et
          s'arrête dès que le client se déconnecte. Ces tickets vaudront{' '}
          <strong>{Math.round(plan.validityDurationSeconds / 3600)} h de connexion réelle</strong>,
          étalées sur autant de jours que le client voudra.
          {/* Pour un ticket de quelques heures, c'est équivalent. Pour un
              forfait long, c'est un tout autre produit — le dire seulement
              là où ça change quelque chose. */}
          {plan.validityDurationSeconds > 86_400 &&
            " Sur un forfait de cette durée, c'est bien plus généreux qu'une validité calendaire : préférez User Manager."}
        </p>
      )}

      {/* Ce contrôle interroge les profils **User Manager**. En cible
          HotSpot il ne veut rien dire, et son verdict — « ce profil n'existe
          pas » — découragerait une génération parfaitement valide. Le
          résultat en cache d'une visite précédente suffirait à le faire
          apparaître : c'est la cible qui décide, pas la présence des données. */}
      {/* Offre jamais synchronisée : il n'y a rien à vérifier, et faire
          tourner un contrôle sur un nom absent afficherait « introuvable »
          pour un cas parfaitement normal. */}
      {/* « Sera créé » serait trop affirmatif : un profil du même nom peut
          déjà exister dans User Manager sans que l'offre y soit rattachée, et
          la génération le reprend — en l'alignant — au lieu d'en faire un second. */}
      {!hotspot && !attendu && (
        <p className="mt-1.5 text-xs text-slate-500">
          Cette offre n'est pas encore liée à un profil User Manager. La génération l'y rattachera :
          elle crée le profil s'il manque, et <strong>aligne sur l'offre</strong> un profil du même
          nom qui existerait déjà — sa validité, son prix et son nombre d'appareils. Le nom peut
          différer légèrement de celui de l'offre : User Manager refuse des caractères que le
          HotSpot accepte.
        </p>
      )}
      {!hotspot && attendu && profils.isPending && (
        <p className="mt-1.5 text-xs text-slate-400">Vérification du profil sur le routeur…</p>
      )}
      {!hotspot && attendu && profils.isError && (
        <p className="mt-1.5 text-xs text-amber-700">
          Le routeur n'a pas répondu : impossible de vérifier que le profil existe.
        </p>
      )}
      {!hotspot && trouvé === false && (
        <p className="mt-1.5 text-xs text-red-600">
          L'offre désigne le profil « {attendu} », introuvable dans User Manager. Il a sans doute
          été renommé ou supprimé dans WinBox — resynchronisez l'offre depuis l'écran Offres
          avant de générer.
        </p>
      )}
      {!hotspot && trouvé === true && (
        <p className="mt-1.5 text-xs text-emerald-700">Profil trouvé sur le routeur.</p>
      )}

      {/* Cette phrase disait « on n'y crée plus ». C'est devenu faux le jour
          où la cible est devenue un choix : elle affirmait une règle là où il
          n'y a qu'un défaut. */}
      <p className="mt-2 text-xs text-slate-500">
        Le HotSpot garde sa propre table de comptes, visible sous « Historique HotSpot ». Les
        tickets y sont l'exception : son profil ne borne qu'une session, et la borne repart à
        chaque reconnexion — seul le plafond de temps cumulé les limite vraiment.
      </p>
    </div>
  );
}

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
            <FormField label="Créer les comptes dans">
              <Select
                value={form.target ?? 'USER_MANAGER'}
                onChange={(e) =>
                  setForm({ ...form, target: e.target.value as GenerateBatchInput['target'] })
                }
              >
                <option value="USER_MANAGER">User Manager (recommandé)</option>
                <option value="HOTSPOT">HotSpot</option>
              </Select>
            </FormField>
            <div className="col-span-2 flex items-end md:col-span-1">
              <Button type="submit" disabled={generate.isPending} className="w-full">
                {generate.isPending ? 'Génération…' : 'Générer'}
              </Button>
            </div>
            {error && <p className="col-span-2 text-sm text-red-600 md:col-span-4">{error}</p>}
            <div className="col-span-2 md:col-span-4">
              <CibleGeneration
                plan={plans?.find((p) => p.id === form.planId)}
                cible={form.target ?? 'USER_MANAGER'}
              />
            </div>
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
          {STATUTS.map((s) => (
            <option key={s} value={s}>
              {libellé(STATUT_TICKET, s).label}
            </option>
          ))}
        </Select>
        <Compteur requête={vouchers} nombre={vouchers.data?.length ?? 0} unité="ticket(s)" />
      </div>

      {vouchers.isLoading ? (
        <TableSkeleton columns={4} />
      ) : vouchers.isError ? (
        <PanneDeLecture requête={vouchers} quoi="les tickets" />
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

  if (expired.isLoading) return <TableSkeleton columns={4} />;
  if (expired.isError) return <PanneDeLecture requête={expired} quoi="les tickets expirés" />;

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
            <Badge tone={libellé(STATUT_TICKET, voucher.status).ton}>
              {libellé(STATUT_TICKET, voucher.status).label}
            </Badge>
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
        <EmptyRow colSpan={6}>{emptyLabel}</EmptyRow>
      )}
    </Table>
  );
}
