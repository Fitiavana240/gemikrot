import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { courrielPlateformePossible } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { Button, Input } from './ui';

/**
 * « Confirmez votre adresse », et le code à six chiffres.
 *
 * **Ne ferme aucune porte, et c'est délibéré.** Bloquer la console sur un
 * courriel qui n'arrive pas — SMTP muet, boîte pleine, message tombé en
 * indésirables — transformerait un accessoire en panne totale, le premier
 * jour, chez quelqu'un qui vient de s'inscrire. Le compte travaille ; le
 * bandeau insiste.
 *
 * Ce qui se joue vraiment est ailleurs : **sans adresse confirmée, on ne peut
 * prévenir l'exploitant de rien** — ni échéance, ni reçu d'abonnement, ni
 * paiement d'un client qui attend son code. Le bandeau le dit dans ces
 * termes plutôt qu'en réclamant une formalité.
 *
 * **Et quand aucun courriel ne peut partir, il ne réclame pas de code.** Le
 * bandeau annonçait << un code a été envoyé >> sans savoir si quoi que ce
 * soit était parti. Le serveur d'envoi de la plateforme n'étant pas réglé,
 * rien ne partait : l'exploitant relisait sa boîte, ses indésirables,
 * recliquait sur << Renvoyer >> qui répondait encore que c'était parti. Il
 * n'avait rien fait de travers et aucun moyen de s'en sortir. Le champ
 * disparaît donc, et la cause prend sa place.
 */

export function ConfirmationCourriel() {
  const { user, confirmerAdresse } = useAuth();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const confirmer = useMutation({
    mutationFn: () => api.post<{ confirme: boolean }>('/auth/confirmer-courriel', { code }),
    onSuccess: () => {
      setErreur(null);
      // L'état local suit tout de suite : attendre la prochaine connexion
      // laisserait le bandeau en place après un succès, et on recommencerait.
      confirmerAdresse();
    },
    onError: (e) => setErreur(e instanceof ApiError ? e.message : 'Le code n’a pas été accepté.'),
  });

  const renvoyer = useMutation({
    mutationFn: () => api.post<{ envoye: boolean; erreur?: string }>('/auth/renvoyer-code', {}),
    onSuccess: (r) => {
      setErreur(r.envoye ? null : (r.erreur ?? null));
      setMessage(r.envoye ? `Un nouveau code est parti vers ${user?.email}.` : null);
    },
    onError: (e) => setErreur(e instanceof ApiError ? e.message : 'Le renvoi a échoué.'),
  });

  // Interrogee avant de reclamer quoi que ce soit. Tant qu'on ne sait pas,
  // on ne montre rien : afficher un champ puis le retirer serait pire que
  // d'attendre une seconde.
  const courriel = useQuery({
    queryKey: ['courriel-plateforme'],
    queryFn: courrielPlateformePossible,
    staleTime: 60_000,
  });

  if (!user || user.emailVerifie) return null;
  if (courriel.isPending) return null;

  if (courriel.data && !courriel.data.possible) {
    return (
      <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">Aucun courriel ne peut partir de la plateforme.</p>
        <p className="mt-1">
          Votre adresse <strong>{user.email}</strong> ne peut donc pas être confirmée : le code
          à six chiffres n’a nulle part par où passer. Ce n’est pas de votre fait, et rien
          n’est bloqué dans la console — mais tant que le serveur d’envoi n’est pas réglé,
          nous ne pourrons vous prévenir de rien : ni échéance d’abonnement, ni paiement
          d’un client qui attend son code, ni panne d’un routeur.
        </p>
        {user.role === 'SUPER_ADMIN' ? (
          <p className="mt-2">
            <Link to="/settings/plateforme" className="font-medium underline hover:no-underline">
              Régler le courriel de la plateforme
            </Link>
          </p>
        ) : (
          <p className="mt-2">
            Signalez-le à GeMikrot : le réglage est de son côté, pas du vôtre.
          </p>
        )}
      </div>
    );
  }

  const soumettre = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim().length === 6) confirmer.mutate();
  };

  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">Confirmez votre adresse électronique.</p>
      <p className="mt-1">
        Un code à six chiffres a été envoyé à <strong>{user.email}</strong>. Tant qu’elle n’est pas
        confirmée, nous ne pouvons vous prévenir de rien : ni échéance d’abonnement, ni paiement
        d’un client qui attend son code, ni panne d’un routeur.
      </p>

      <form onSubmit={soumettre} className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          inputMode="numeric"
          className="w-32 font-mono tracking-widest"
          aria-label="Code de confirmation"
        />
        <Button type="submit" disabled={code.trim().length !== 6 || confirmer.isPending}>
          {confirmer.isPending ? 'Vérification…' : 'Confirmer'}
        </Button>
        <button
          type="button"
          onClick={() => renvoyer.mutate()}
          disabled={renvoyer.isPending}
          className="text-sm font-medium text-amber-900 underline hover:no-underline"
        >
          {renvoyer.isPending ? 'Envoi…' : 'Renvoyer le code'}
        </button>
      </form>

      {message && <p className="mt-2 text-sm">{message}</p>}
      {erreur && <p className="mt-2 text-sm font-medium text-red-700">{erreur}</p>}
    </div>
  );
}
