import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
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

  if (!user || user.emailVerifie) return null;

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
