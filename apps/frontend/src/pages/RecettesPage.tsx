import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type Pas } from '../api/dashboard';
import { useCurrency } from '../api/money';
import { ApiError } from '../api/client';
import {
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

/**
 * Ce qui est entré, quand, et par quelle offre.
 *
 * Le tableau de bord donnait déjà un total par offre, mais **depuis
 * toujours** : on y lisait le cumul de l'histoire, jamais « ce mois-ci ».
 * Impossible d'y voir qu'une offre a cessé de se vendre, ni de comparer un
 * mois au précédent — la seule question qu'on pose vraiment à ses chiffres.
 */

/** `2026-09-21` — ce qu'attend un champ de type `date`. */
function jourIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

const PREMIER_DU_MOIS = () => {
  const n = new Date();
  return jourIso(new Date(n.getFullYear(), n.getMonth(), 1));
};

/** Une tranche, dite comme on la lit : « lun. 21 sept. », « sept. 2026 ». */
function libelléTranche(iso: string, pas: Pas): string {
  const d = new Date(iso);
  if (pas === 'mois') return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  if (pas === 'semaine')
    return `semaine du ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`;
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
}

export function RecettesPage() {
  const { format } = useCurrency();
  const [du, setDu] = useState(PREMIER_DU_MOIS);
  const [au, setAu] = useState(() => jourIso(new Date()));
  const [pas, setPas] = useState<Pas>('jour');
  const [erreurExport, setErreurExport] = useState<string | null>(null);
  const [exportEnCours, setExportEnCours] = useState(false);

  const recette = useQuery({
    queryKey: ['recette', du, au, pas],
    queryFn: () => dashboardApi.recette(du, au, pas),
  });

  const données = recette.data;
  // Le maximum sert d'échelle aux barres : sans lui, deux tranches de
  // montants très différents se dessineraient de la même longueur.
  const plusHaute = Math.max(1, ...(données?.lignes ?? []).map((l) => l.montant));

  const exporter = async () => {
    setErreurExport(null);
    setExportEnCours(true);
    try {
      await dashboardApi.exportCsv(du, au);
    } catch (e) {
      setErreurExport(e instanceof ApiError ? e.message : 'Le téléchargement a échoué.');
    } finally {
      setExportEnCours(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Recettes"
        description="Ce qui est réellement entré, par offre et par période. Seuls les paiements vérifiés comptent : un paiement en attente est une promesse, pas une recette."
      />

      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Du">
          <Input type="date" value={du} max={au} onChange={(e) => setDu(e.target.value)} />
        </FormField>
        <FormField label="Au">
          <Input type="date" value={au} min={du} onChange={(e) => setAu(e.target.value)} />
        </FormField>
        <FormField label="Regrouper par">
          <Select value={pas} onChange={(e) => setPas(e.target.value as Pas)} className="w-auto">
            <option value="jour">Jour</option>
            <option value="semaine">Semaine</option>
            <option value="mois">Mois</option>
          </Select>
        </FormField>
        <Button className="ml-auto" variant="secondary" disabled={exportEnCours} onClick={exporter}>
          {exportEnCours ? 'Préparation…' : 'Exporter en CSV'}
        </Button>
      </div>

      {erreurExport && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {erreurExport}
        </p>
      )}

      {recette.isPending ? (
        <TableSkeleton columns={4} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card title="Recette de la période">
              <div className="text-2xl font-semibold tabular-nums text-slate-900">
                {format(données?.total ?? 0)}
              </div>
            </Card>
            <Card title="Paiements vérifiés">
              <div className="text-2xl font-semibold tabular-nums text-slate-900">
                {données?.nombre ?? 0}
              </div>
            </Card>
            <Card title="Panier moyen">
              {/* Sans vente, une division rendrait « NaN » — un mot qui n'a
                  rien à faire sur un écran de caisse. */}
              <div className="text-2xl font-semibold tabular-nums text-slate-900">
                {données && données.nombre > 0 ? format(données.total / données.nombre) : '—'}
              </div>
            </Card>
          </div>

          <Card title="Par offre, sur la période">
            <Table head={['Offre', 'Paiements', 'Recette', 'Part']} colonnes={false}>
              {(données?.parOffre ?? []).map((o) => {
                const part = données && données.total > 0 ? o.montant / données.total : 0;
                return (
                  <tr key={o.planId}>
                    <td className="px-3 py-2 font-medium">{o.planName}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{o.nombre}</td>
                    <td className="px-3 py-2 tabular-nums font-medium">{format(o.montant)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-sky-500"
                            style={{ width: `${Math.round(part * 100)}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-xs text-slate-500">
                          {Math.round(part * 100)} %
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(données?.parOffre.length ?? 0) === 0 && (
                <EmptyRow colSpan={4} hint="Aucun paiement vérifié sur ces dates.">
                  Rien encaissé
                </EmptyRow>
              )}
            </Table>
          </Card>

          <Card title={`Détail par ${pas}`}>
            <Table head={['Période', 'Offre', 'Paiements', 'Recette', '']} colonnes={false}>
              {(données?.lignes ?? []).map((l) => (
                <tr key={`${l.début}-${l.planId}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {libelléTranche(l.début, pas)}
                  </td>
                  <td className="px-3 py-2">{l.planName}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">{l.nombre}</td>
                  <td className="px-3 py-2 tabular-nums font-medium">{format(l.montant)}</td>
                  <td className="w-40 px-3 py-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${Math.round((l.montant / plusHaute) * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {(données?.lignes.length ?? 0) === 0 && (
                <EmptyRow colSpan={5}>Rien sur cette période</EmptyRow>
              )}
            </Table>
          </Card>

          <p className="max-w-3xl text-xs text-slate-500">
            La date retenue est celle de la <strong>vérification</strong>, pas celle de la
            déclaration : un règlement déclaré le 31 et vérifié le 2 appartient au mois suivant,
            comme le dirait un comptable. L&apos;export CSV, lui, porte{' '}
            <strong>tous les statuts</strong> — en attente et refusés compris — parce qu&apos;un
            comptable veut aussi voir ce qui n&apos;est pas entré ; le filtre se fait dans le
            tableur.
          </p>
        </>
      )}
    </div>
  );
}
