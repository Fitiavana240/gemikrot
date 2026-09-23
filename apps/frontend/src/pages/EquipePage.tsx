import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminUsersApi, type AdminUserView } from '../api/admin-users';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ROLES, ROLES_DELEGABLES, nomDuRole } from '../lib/roles';
import { Confirmation } from '../components/Edition';
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  ErrorNote,
  FormField,
  Input,
  PageHeader,
  Select,
  Table,
  TableSkeleton,
} from '../components/ui';

/**
 * Qui d'autre que vous entre dans la console.
 *
 * L'API existait depuis le début ; aucun écran ne s'en servait. Un exploitant
 * ne pouvait donc pas confier le comptoir à son vendeur sans lui prêter son
 * propre mot de passe — et le journal enregistrait alors chaque geste sous son
 * nom à lui, ce qui vide le journal de tout intérêt le jour où l'on cherche
 * qui a annulé un ticket.
 *
 * **Deux rôles seulement, et le serveur refuse les autres.** On délègue, on ne
 * se clone pas : un second administrateur pourrait reconfigurer le routeur,
 * changer les tarifs et créer des comptes à son tour. Ce n'est pas un réglage
 * d'écran, c'est une règle du serveur — `admin-users.service` rejette tout
 * rôle qui n'est pas superviseur ou lecture seule.
 */

/** Le mot de passe minimal accepté par le serveur (`MIN_PASSWORD_LENGTH`). */
const LONGUEUR_MIN = 6;

function Ligne({
  compte,
  moi,
  onSupprimer,
}: {
  compte: AdminUserView;
  moi: boolean;
  onSupprimer: () => void;
}) {
  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-2 text-slate-900">
        {compte.email}
        {moi && <span className="ml-2 text-xs text-slate-500">(vous)</span>}
      </td>
      <td className="px-3 py-2">
        <Badge tone={compte.role === 'ADMIN' || compte.role === 'SUPER_ADMIN' ? 'amber' : 'slate'}>
          {nomDuRole(compte.role)}
        </Badge>
      </td>
      <td className="px-3 py-2 text-slate-600">
        {compte.lastLoginAt
          ? new Date(compte.lastLoginAt).toLocaleString('fr-FR')
          : 'jamais connecté'}
      </td>
      <td className="px-3 py-2 text-slate-600">
        {new Date(compte.createdAt).toLocaleDateString('fr-FR')}
      </td>
      <td className="px-3 py-2 text-right">
        {/* Ni son propre compte — on se fermerait la porte — ni un
            administrateur, que le serveur protège de toute façon. */}
        {!moi && compte.role !== 'ADMIN' && compte.role !== 'SUPER_ADMIN' && (
          <Button variant="danger" onClick={onSupprimer}>
            Retirer
          </Button>
        )}
      </td>
    </tr>
  );
}

export function EquipePage() {
  const { user, canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const [àRetirer, setÀRetirer] = useState<AdminUserView | null>(null);
  const [form, setForm] = useState<{ email: string; password: string; role: 'OPERATOR' | 'VIEWER' }>(
    { email: '', password: '', role: 'OPERATOR' },
  );

  const comptes = useQuery({ queryKey: ['admin-users'], queryFn: adminUsersApi.list });

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const creer = useMutation({
    mutationFn: adminUsersApi.create,
    onSuccess: () => {
      setForm({ email: '', password: '', role: 'OPERATOR' });
      setErreur(null);
      void rafraichir();
    },
    onError: (e: unknown) =>
      setErreur(e instanceof ApiError ? e.message : "Le compte n'a pas pu être créé."),
  });

  const retirer = useMutation({
    mutationFn: (id: string) => adminUsersApi.remove(id),
    onSuccess: () => {
      setÀRetirer(null);
      void rafraichir();
    },
    onError: (e: unknown) =>
      setErreur(e instanceof ApiError ? e.message : "Le compte n'a pas pu être retiré."),
  });

  const soumettre = (e: FormEvent) => {
    e.preventDefault();
    if (form.password.length < LONGUEUR_MIN) {
      setErreur(`Le mot de passe doit contenir au moins ${LONGUEUR_MIN} caractères.`);
      return;
    }
    creer.mutate(form);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Équipe"
        description="Qui d'autre que vous entre dans la console, et jusqu'où il va."
      />

      {erreur && <ErrorNote onRetry={() => setErreur(null)}>{erreur}</ErrorNote>}

      <Card title="Les rôles que vous pouvez attribuer">
        {/*
          Le rôle se choisit une fois et se regrette longtemps : dire ce que
          chacun ne peut PAS faire évite l'erreur la plus courante, donner
          trop de droits « pour que ça marche ».
        */}
        <div className="grid gap-3 sm:grid-cols-2">
          {ROLES_DELEGABLES.map((code) => (
            <div key={code} className="rounded-lg border border-slate-200 p-3">
              <h3 className="font-semibold text-slate-900">{ROLES[code].nom}</h3>
              <p className="mt-1 text-sm text-slate-600">{ROLES[code].resume}</p>
              <p className="mt-1 text-sm text-slate-500">{ROLES[code].limite}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Un second administrateur ne peut pas être créé ici : il pourrait reconfigurer le routeur,
          changer vos tarifs et créer des comptes à son tour. Le serveur le refuse, ce n&apos;est
          pas seulement masqué à l&apos;écran.
        </p>
      </Card>

      {canWrite && (
        <Card title="Ajouter un compte">
          <form onSubmit={soumettre} className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <FormField label="Adresse électronique">
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="vendeur@exemple.mg"
              />
            </FormField>
            <FormField label={`Mot de passe (${LONGUEUR_MIN} caractères au moins)`}>
              <Input
                type="password"
                required
                minLength={LONGUEUR_MIN}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </FormField>
            <FormField label="Rôle">
              <Select
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as 'OPERATOR' | 'VIEWER' })
                }
              >
                {ROLES_DELEGABLES.map((code) => (
                  <option key={code} value={code}>
                    {ROLES[code].nom}
                  </option>
                ))}
              </Select>
            </FormField>
            <Button type="submit" disabled={creer.isPending}>
              {creer.isPending ? 'Création…' : 'Créer le compte'}
            </Button>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            Transmettez-lui ce mot de passe de vive voix ; il pourra le changer lui-même dans
            Paramètres → Mon compte.
          </p>
        </Card>
      )}

      <Card title="Les comptes">
        {comptes.isPending ? (
          <TableSkeleton columns={5} />
        ) : comptes.isError ? (
          // Sans cette branche, une lecture en échec affichait « Aucun
          // compte. » — indiscernable d'une équipe vide. On croirait avoir
          // perdu ses comptes, ou pire, on recréerait ceux qui existent déjà.
          <ErrorNote onRetry={() => void comptes.refetch()}>
            La liste des comptes n&apos;a pas pu être lue. Ceux qui existent sont intacts : c&apos;est
            l&apos;affichage qui a échoué, pas vos comptes.
          </ErrorNote>
        ) : (
          <Table head={['Adresse', 'Rôle', 'Dernière connexion', 'Créé le', '']} colonnes={false}>
            {(comptes.data ?? []).length === 0 ? (
              <EmptyRow colSpan={5}>Aucun compte.</EmptyRow>
            ) : (
              (comptes.data ?? []).map((compte) => (
                <Ligne
                  key={compte.id}
                  compte={compte}
                  moi={compte.id === user?.id}
                  onSupprimer={() => setÀRetirer(compte)}
                />
              ))
            )}
          </Table>
        )}
      </Card>

      {àRetirer && (
        <Confirmation
          titre="Retirer ce compte ?"
          libelléConfirmer="Retirer"
          enCours={retirer.isPending}
          onConfirmer={() => retirer.mutate(àRetirer.id)}
          onAnnuler={() => setÀRetirer(null)}
        >
          {àRetirer.email} ne pourra plus se connecter. Ce qu&apos;il a fait reste au journal, à
          son nom.
        </Confirmation>
      )}
    </div>
  );
}
