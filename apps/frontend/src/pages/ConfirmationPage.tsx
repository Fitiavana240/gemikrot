import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from '../components/Brand';
import { Button, Input } from '../components/ui';

/**
 * L'écran qui demande le code, juste après l'inscription.
 *
 * Le code partait, et rien ne le réclamait : on arrivait dans la console avec
 * un bandeau de plus, au milieu de quinze autres choses à découvrir. Demandé
 * ici, seul sur l'écran, il se saisit dans la minute où il arrive — c'est-à-dire
 * au seul moment où l'on a encore la boîte ouverte à côté.
 *
 * **C'est cette saisie qui prévient la plateforme.** Tant que l'adresse n'a pas
 * répondu, le SUPER_ADMIN n'apprend rien : annoncer un exploitant qu'on ne sait
 * pas joindre n'annonce rien d'utile, et une inscription abandonnée en chemin
 * encombrerait sa boîte sans qu'il puisse rien en faire.
 *
 * **On peut passer outre**, et le lien le dit franchement. Enfermer quelqu'un
 * derrière un courriel qui n'arrive pas — SMTP muet, boîte pleine, message en
 * indésirables — ferait d'un accessoire une panne totale, le premier jour.
 * Le bandeau de la console prend alors le relais.
 */

export function ConfirmationPage() {
  const { user, confirmerAdresse } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const confirmer = useMutation({
    mutationFn: () => api.post<{ confirme: boolean }>('/auth/confirmer-courriel', { code }),
    onSuccess: () => {
      confirmerAdresse();
      navigate('/', { replace: true });
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

  if (!user) return <Navigate to="/login" replace />;
  // Déjà confirmée : rester ici demanderait un code qui n'existe plus.
  if (user.emailVerifie) return <Navigate to="/" replace />;

  const soumettre = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim().length === 6) confirmer.mutate();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <BrandMark className="mx-auto h-12 w-12" />
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">
          Confirmez votre adresse
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Un code à six chiffres vient de partir vers{' '}
          <strong className="break-all text-slate-800">{user.email}</strong>. Saisissez-le
          ci-dessous.
        </p>

        <form onSubmit={soumettre} className="mt-6 space-y-3">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            inputMode="numeric"
            autoFocus
            aria-label="Code de confirmation"
            className="text-center font-mono text-2xl tracking-[0.4em]"
          />
          <Button
            type="submit"
            uiSize="md"
            className="w-full"
            disabled={code.trim().length !== 6 || confirmer.isPending}
          >
            {confirmer.isPending ? 'Vérification…' : 'Confirmer mon adresse'}
          </Button>
        </form>

        {message && (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </p>
        )}
        {erreur && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erreur}</p>
        )}

        <div className="mt-5 space-y-2 text-sm">
          <button
            type="button"
            onClick={() => renvoyer.mutate()}
            disabled={renvoyer.isPending}
            className="font-medium text-sky-700 hover:underline"
          >
            {renvoyer.isPending ? 'Envoi…' : 'Je n’ai rien reçu — renvoyer le code'}
          </button>
          <p className="text-xs text-slate-500">
            Regardez aussi vos indésirables. Le code est valable une heure.
          </p>
        </div>

        {/* Franchement offert : enfermer quelqu'un derrière un courriel qui
            n'arrive pas ferait d'un accessoire une panne totale. */}
        <p className="mt-6 border-t border-slate-200 pt-4 text-sm">
          <Link to="/" className="text-slate-500 hover:text-slate-700 hover:underline">
            Plus tard — entrer dans la console
          </Link>
        </p>
      </div>
    </div>
  );
}
