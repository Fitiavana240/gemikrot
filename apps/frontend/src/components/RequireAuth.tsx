import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { publicApi } from '../api/public';

/**
 * Qui arrive ici sans être connecté, et où l'envoyer.
 *
 * L'écran de connexion de la console était la seule réponse. Sur le domaine
 * d'un exploitant, cela veut dire qu'un client qui tape l'adresse de son
 * fournisseur tombe sur une page d'administration : un formulaire qui lui
 * demande un mot de passe qu'il n'a pas, sans aucun rapport avec ce qu'il
 * cherchait — acheter une heure d'Internet.
 *
 * Les domaines étaient enregistrés depuis le début ; ils s'impriment même sur
 * le QR des tickets. Rien ne s'en servait pour répondre.
 *
 * **La question n'est posée que pour un visiteur anonyme.** Le chargement de
 * la console, lui, ne coûte pas un appel de plus : l'exploitant est connecté.
 * Et `/login` reste atteignable en le tapant — l'exploitant qui administre
 * depuis son propre domaine n'est enfermé nulle part.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  const hôte = useQuery({
    queryKey: ['resolution-hote'],
    queryFn: publicApi.resoudreHote,
    enabled: !isAuthenticated,
    // L'adresse ne change pas sous les pieds du visiteur : une fois suffit.
    staleTime: Infinity,
    retry: false,
  });

  if (isAuthenticated) return children;

  // Tant que la réponse n'est pas là, on n'affiche rien plutôt que l'écran de
  // connexion : le montrer une demi-seconde avant de le remplacer par la page
  // client donnerait l'impression d'une erreur, sur l'écran où il ne faut
  // surtout pas en donner.
  if (hôte.isPending) return null;

  const slug = hôte.data?.slug;
  if (slug) return <Navigate to={`/p/${slug}`} replace />;

  return <Navigate to="/login" state={{ from: location.pathname }} replace />;
}
