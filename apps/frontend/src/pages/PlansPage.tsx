import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { plansApi, validitéEnHeures, type CreatePlanInput } from '../api/plans';
import { hotspotTabsApi } from '../api/mikrotik-tabs';
import { ChampDuree } from '../components/Edition';
import { useRouterSelection } from '../routers/RouterContext';
import { useAuth } from '../auth/AuthContext';
import { libellé, STATUT_SIMPLE } from '../api/libelles';
import { useCurrency } from '../api/money';
import { ApiError } from '../api/client';
import { Badge, Button, FormField, Input, PageHeader, PanneDeLecture, Select, Table, TableSkeleton } from '../components/ui';
import { Modale } from '../components/Modale';
import { Confirmation } from '../components/Edition';

const EMPTY_FORM: CreatePlanInput = {
  name: '',
  price: 0,
  validityDurationSeconds: 3600,
  startsWhen: 'FIRST_AUTH',
};

export function PlansPage() {
  const { canWrite } = useAuth();
  const { currentId } = useRouterSelection();
  const { currency, format } = useCurrency();
  const queryClient = useQueryClient();
  const offres = useQuery({ queryKey: ['plans'], queryFn: plansApi.list });
  /**
   * Les profils du routeur, pour confronter chaque offre à ce qui existe
   * vraiment.
   *
   * Une offre désigne un profil par son nom ; renommé ou supprimé depuis
   * WinBox, le lien casse en silence et l'offre reste « actif », vendable. Ce
   * parc en portait une dans ce cas. La panne ne se déclarait qu'à la
   * génération, un échec par ticket, devant le client.
   *
   * L'absence de réponse du routeur ne conclut rien : on ne dit « introuvable »
   * que si le routeur a répondu.
   */
  const profilsRouteur = useQuery({
    queryKey: ['hotspot-profiles', currentId],
    queryFn: () => hotspotTabsApi.profiles(currentId),
    retry: false,
  });
  const nomsProfils = profilsRouteur.isSuccess
    ? new Set((profilsRouteur.data ?? []).map((p) => p.name))
    : null;
  const plans = offres.data;
  const [form, setForm] = useState<CreatePlanInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [créer, setCréer] = useState(false);
  /** L'offre qu'on s'apprête à archiver, tant que ce n'est pas confirmé. */
  const [àArchiver, setÀArchiver] = useState<{ id: string; name: string } | null>(null);

  const createMutation = useMutation({
    mutationFn: plansApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      setForm(EMPTY_FORM);
      setError(null);
      setCréer(false);
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
    onSuccess: () => {
      setÀArchiver(null);
      queryClient.invalidateQueries({ queryKey: ['plans'] });
    },
  });

  function handleSubmit() {
    createMutation.mutate(form);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offres"
        description="Ce que vous vendez : durée, prix, débit. Une offre créée ici se retrouve sur le routeur, et sur la page de paiement de vos clients."
      />

      {àArchiver && (
        <Confirmation
          titre={`Archiver l’offre « ${àArchiver.name} » ?`}
          libelléConfirmer="Archiver cette offre"
          enCours={archiveMutation.isPending}
          onAnnuler={() => setÀArchiver(null)}
          onConfirmer={() => archiveMutation.mutate(àArchiver.id)}
        >
          Elle disparaît de la page de paiement et ne peut plus servir à générer un lot. Les
          tickets déjà vendus <strong>continuent de fonctionner</strong> : le routeur ne
          connaît que le profil, et le profil reste. Rien n&apos;est effacé.
        </Confirmation>
      )}

      {canWrite && (
        <div>
          <Button onClick={() => setCréer(true)}>Nouvelle offre</Button>
        </div>
      )}

      {canWrite && créer && (
        <Modale
          titre="Nouvelle offre"
          onFermer={() => setCréer(false)}
          actions={
            <Button disabled={createMutation.isPending} onClick={() => handleSubmit()}>
              {createMutation.isPending ? 'Création…' : 'Créer l’offre'}
            </Button>
          }
          note={
            <>
              Créer l&apos;offre crée aussi son profil sur le routeur : les deux restent liés
              par le nom. <strong>Démarre</strong> décide de quand court la validité — à la
              première connexion, un ticket vendu aujourd&apos;hui et utilisé la semaine
              prochaine reste entier ; dès l&apos;attribution, il s&apos;écoule sans que
              personne s&apos;en serve.
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
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
            {/* Le champ demandait des secondes : une offre « 2 heures » s'y
                saisissait « 7200 », et une de quinze minutes obligeait à un
                calcul mental à chaque création. Le composant partagé choisit
                l'unité qui tombe juste, comme partout ailleurs dans la console. */}
            <FormField label="Validité">
              <ChampDuree
                secondes={form.validityDurationSeconds}
                onChange={(secondes) =>
                  setForm({ ...form, validityDurationSeconds: secondes ?? 0 })
                }
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
            <div className="sm:col-span-2">
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <button type="submit" className="hidden" aria-hidden />
          </form>
        </Modale>
      )}

      {nomsProfils &&
        (plans ?? []).some(
          (p) => p.status === 'ACTIVE' && !nomsProfils.has(p.mikrotikProfileName),
        ) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Une offre au moins désigne un profil qui n'existe plus sur le routeur. Elle reste
            vendable, et <strong>chaque ticket généré échouera</strong> — le routeur refuse un
            profil qu'il ne connaît pas. « Synchroniser » recrée le profil manquant.
          </div>
        )}

      {offres.isPending ? (
        <TableSkeleton columns={4} />
      ) : offres.isError ? (
        <PanneDeLecture requête={offres} quoi="les offres" />
      ) : (
        <Table head={['Nom', 'Prix', 'Validité', 'Profil RouterOS', 'Statut', '']}>
          {plans?.map((plan) => (
            <tr key={plan.id}>
              <td className="px-3 py-2">{plan.name}</td>
              <td className="px-3 py-2">{format(plan.price)}</td>
              {/* En heures, comme le veut le commerce de ce parc : les offres
                  s'appellent « 2Heure-500Ar » et le ticket imprimé dit la même
                  chose. Une colonne en jours obligerait à convertir de tête
                  entre l'écran et le papier. */}
              <td className="px-3 py-2">{validitéEnHeures(plan.validityDurationSeconds)}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-500">
                {plan.mikrotikProfileName}
                {nomsProfils && !nomsProfils.has(plan.mikrotikProfileName) && (
                  <Badge tone="red">absent du routeur</Badge>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge tone={libellé(STATUT_SIMPLE, plan.status).ton}>
                  {libellé(STATUT_SIMPLE, plan.status).label}
                </Badge>
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
                    <Button
                      variant="secondary"
                      onClick={() => setÀArchiver({ id: plan.id, name: plan.name })}
                    >
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
