/**
 * Ce qu'une coupure d'accès a réellement atteint sur le routeur.
 *
 * Désactiver un compte ne coupe rien tout de suite : la session en cours
 * reste ouverte, et le profil serveur de ce parc accepte `mac-cookie` avec
 * une durée de vie de trois jours — le client se reconnecte sans que le
 * compte désactivé soit consulté. Couper suppose donc trois gestes, et
 * l'exploitant doit pouvoir vérifier que les trois ont eu lieu.
 */
export interface Coupure {
  cookiesRemoved: number;
  sessionsClosed: number;
}

/**
 * La phrase qui suit une coupure, **y compris quand elle n'a rien trouvé**.
 *
 * Zéro session et zéro cookie n'est pas un non-événement : c'est justement ce
 * que l'exploitant a besoin de savoir pour être sûr que le client est hors
 * ligne. Ne rien dire dans ce cas laisserait le doute que le bouton n'a pas
 * fonctionné.
 */
export function phraseCoupure(coupure: Coupure | null | undefined): string {
  if (!coupure) return 'Compte réactivé.';

  const { sessionsClosed: sessions, cookiesRemoved: cookies } = coupure;
  if (sessions === 0 && cookies === 0) {
    return 'Accès coupé. Aucune session en cours, aucun cookie à effacer : le client était déjà hors ligne.';
  }

  const parties: string[] = [];
  if (sessions > 0) parties.push(`${sessions} session${sessions > 1 ? 's' : ''} fermée${sessions > 1 ? 's' : ''}`);
  if (cookies > 0) parties.push(`${cookies} cookie${cookies > 1 ? 's' : ''} effacé${cookies > 1 ? 's' : ''}`);
  return `Accès coupé — ${parties.join(', ')}. Le client est hors ligne.`;
}
