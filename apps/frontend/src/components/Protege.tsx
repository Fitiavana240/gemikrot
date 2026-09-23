import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLES, nomDuRole } from '../lib/roles';
import { rolesRequis } from './nav';
import { EmptyState } from './ui';

/**
 * L'écran qu'un rôle n'a pas le droit d'ouvrir.
 *
 * Retirer l'entrée du menu ne protège rien : l'adresse se tape, elle se
 * partage par message, elle dort dans l'historique du navigateur. Sans cette
 * garde, un superviseur qui ouvre `/hotspot` voit la page se monter puis
 * chaque tableau se remplir de refus — le serveur refuse bien, lui, mais un
 * écran couvert d'erreurs ressemble à une panne, pas à une règle. On appelle
 * l'exploitant pour signaler un bogue qui n'existe pas.
 *
 * **Les rôles admis ne sont pas redits ici**, ils se lisent sur la navigation
 * elle-même : une seconde liste divergerait dès la première entrée ajoutée,
 * et divergerait du mauvais côté — un écran atteignable qu'on croyait fermé.
 *
 * **Ce n'est pas la sécurité, et il ne faut pas le croire.** La barrière est
 * au serveur, où chaque route porte son `@Roles`. Ici on explique ; là-bas on
 * refuse.
 */
export function Protege({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();

  const requis = rolesRequis(pathname);
  if (!requis || (user && requis.includes(user.role))) return <>{children}</>;

  return (
    <EmptyState
      title="Cet écran ne vous est pas ouvert"
      hint={
        <>
          Votre compte est <strong>{nomDuRole(user?.role)}</strong>.{' '}
          {user?.role && ROLES[user.role]?.limite} Demandez à l&apos;administrateur de votre
          réseau s&apos;il vous faut y accéder.
        </>
      }
      action={
        <Link
          to="/"
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
        >
          Revenir à la vue d&apos;ensemble
        </Link>
      }
    />
  );
}
