import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { changePassword } from '../api/auth';
import { ApiError } from '../api/client';
import { Button, Card, FormField, Input } from './ui';

/** Même minimum que le serveur ; le répéter évite un aller-retour inutile. */
const LONGUEUR_MINIMALE = 6;

/**
 * Le mot de passe de son propre compte.
 *
 * Il n'existait aucun moyen d'en changer — ni écran, ni route. Un mot de passe
 * éventé ne laissait qu'une porte de sortie : créer un second compte
 * d'administration et supprimer l'ancien. Sur cette installation, deux comptes
 * SUPER_ADMIN existent et l'un d'eux porte encore son mot de passe d'origine.
 *
 * Placé dans les Réglages plutôt que dans un menu de compte : c'est là qu'on
 * cherche un réglage, et le produit n'a pas d'autre écran de ce genre.
 */
export function MotDePasseCard() {
  const [actuel, setActuel] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState(false);

  const changer = useMutation({
    mutationFn: () => changePassword(actuel, nouveau),
    onSuccess: () => {
      // Vider les trois champs : laisser le mot de passe à l'écran après
      // coup est exactement ce qu'on cherche à éviter en le changeant.
      setActuel('');
      setNouveau('');
      setConfirmation('');
      setErreur(null);
      setFait(true);
    },
    onError: (e: unknown) => {
      setFait(false);
      setErreur(e instanceof ApiError ? e.message : 'Erreur inconnue');
    },
  });

  // Vérifiée ici et non au serveur : c'est une faute de frappe, pas une règle
  // métier, et l'aller-retour n'apprendrait rien de plus.
  const discordance = confirmation.length > 0 && nouveau !== confirmation;
  const prêt =
    actuel.length > 0 && nouveau.length >= LONGUEUR_MINIMALE && nouveau === confirmation;

  return (
    <Card title="Mon mot de passe">
      <p className="mb-3 max-w-2xl text-sm text-slate-600">
        Change celui du compte avec lequel vous êtes connecté, et lui seul. Les sessions déjà
        ouvertes ailleurs continuent de fonctionner jusqu&apos;à leur expiration —{' '}
        <strong>si vous le changez parce qu&apos;il a fuité</strong>, déconnectez aussi les
        autres appareils.
      </p>

      {erreur && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {erreur}
        </p>
      )}
      {fait && (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Mot de passe changé. Il faudra le nouveau à la prochaine connexion.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <FormField label="Mot de passe actuel">
          <Input
            type="password"
            autoComplete="current-password"
            value={actuel}
            onChange={(e) => setActuel(e.target.value)}
          />
        </FormField>
        <FormField label={`Nouveau (${LONGUEUR_MINIMALE} caractères au moins)`}>
          <Input
            type="password"
            autoComplete="new-password"
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
          />
        </FormField>
        <FormField label="Répétez le nouveau">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </FormField>
      </div>

      {discordance && (
        <p className="mt-2 text-sm text-amber-800">Les deux saisies ne correspondent pas.</p>
      )}

      <div className="mt-4">
        <Button disabled={!prêt || changer.isPending} onClick={() => changer.mutate()}>
          {changer.isPending ? 'Changement…' : 'Changer le mot de passe'}
        </Button>
      </div>
    </Card>
  );
}
