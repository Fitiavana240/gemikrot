/**
 * Le nom du client devient son identifiant de connexion.
 *
 * Un nom tel qu'on l'écrit ne peut pas servir tel quel : RouterOS accepte
 * mal les espaces, et le client devra retaper ce nom **sur le clavier d'un
 * téléphone, derrière un portail captif**, sans pouvoir copier-coller. Tout
 * ce qui se saisit mal doit donc disparaître avant, pas après.
 *
 * Le résultat est montré au client **pendant** qu'il remplit le formulaire.
 * Le transformer en silence et le lui révéler à la fin serait une mauvaise
 * surprise au moment précis où il a payé et attend son accès.
 */

/** Ce qu'on peut raisonnablement retaper sans se tromper. */
const LONGUEUR_MIN = 3;
const LONGUEUR_MAX = 24;

/**
 * « Rakoto Jean » → « Rakoto-Jean ». Accents retirés, espaces recollés.
 *
 * Les accents partent parce qu'un portail captif se saisit souvent depuis un
 * clavier qui ne les porte pas, et parce qu'un `é` tapé `e` ne se
 * connecterait pas. La casse est **gardée** : elle aide à se relire, et la
 * comparaison d'unicité, elle, l'ignore.
 */
export function identifiantDepuisNom(nom: string): string {
  return (
    nom
      .normalize('NFD')
      // Les diacritiques forment une plage Unicode à eux seuls une fois la
      // chaîne décomposée : `é` devient `e` + accent, et l'accent s'enlève.
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      // Un tiret en tête ou en queue vient d'une ponctuation de bord et
      // n'apporte rien à la saisie.
      .replace(/^-+|-+$/g, '')
      .slice(0, LONGUEUR_MAX)
      // Le découpage peut retomber sur un tiret : « Jean-Baptiste-Ra… ».
      .replace(/-+$/, '')
  );
}

/**
 * Ce nom peut-il servir d'identifiant ?
 *
 * On refuse avant le paiement plutôt qu'après : un nom impossible découvert
 * à la vérification laisserait un client qui a payé sans accès et sans
 * recours.
 */
export function identifiantUtilisable(identifiant: string): boolean {
  if (identifiant.length < LONGUEUR_MIN || identifiant.length > LONGUEUR_MAX) return false;
  // Au moins une lettre : « 2024 » comme identifiant se confondrait avec une
  // référence, et deux clients le choisiraient le même jour.
  return /[A-Za-z]/.test(identifiant);
}

/**
 * Deux identifiants se valent-ils, du point de vue du routeur ?
 *
 * La comparaison ignore la casse : RouterOS refuserait `Rakoto` et `rakoto`
 * comme deux comptes distincts sur certains chemins, et surtout deux clients
 * croiraient chacun posséder le leur.
 */
export function mêmeIdentifiant(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}
