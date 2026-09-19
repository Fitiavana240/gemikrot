/**
 * Normalisation du téléphone et de la référence de transaction.
 *
 * **Une seule implémentation, partagée.** Le formulaire du client et le
 * lecteur de SMS doivent normaliser exactement pareil : deux normalisations
 * divergentes donneraient un taux de rapprochement de zéro, sans erreur ni
 * trace — juste des paiements qui restent en attente sans qu'on sache
 * pourquoi.
 */

/**
 * Téléphone malgache ramené à sa forme nationale à neuf chiffres.
 *
 * Le même numéro s'écrit `+261 34 03 941 88`, `0340394188`, `261340394188`
 * ou `034 03 941 88` selon qu'il est tapé par le client ou recopié d'un SMS.
 * Tout est ramené à `340394188` : indicatif pays et zéro initial retirés,
 * espaces et ponctuation supprimés.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  // `00261…` puis `261…` : l'indicatif international sous ses deux formes.
  const withoutCountry = digits
    .replace(/^00261/, '')
    .replace(/^261/, '');

  // Un zéro initial est la notation nationale, pas un chiffre du numéro.
  return withoutCountry.replace(/^0/, '');
}

/**
 * Référence de transaction ramenée à ses caractères significatifs.
 *
 * Un opérateur l'écrit `1A2B-3C4D`, le client la recopie `1a2b 3c4d` : même
 * référence, deux chaînes différentes. Majuscules, et rien que des lettres
 * et des chiffres.
 */
export function normalizeReference(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Ce qu'une référence doit valoir pour être exploitable. */
export const REFERENCE_PATTERN = /^[A-Z0-9]{4,32}$/;

/** Neuf chiffres pour un mobile malgache ; large, pour ne pas exclure. */
export const PHONE_PATTERN = /^[0-9]{8,12}$/;

export function isUsablePhone(normalized: string): boolean {
  return PHONE_PATTERN.test(normalized);
}

export function isUsableReference(normalized: string): boolean {
  return REFERENCE_PATTERN.test(normalized);
}

/** Forme lisible pour l'affichage : `034 03 941 88`. */
export function formatPhoneForDisplay(normalized: string): string {
  if (normalized.length !== 9) return normalized;
  return `0${normalized.slice(0, 2)} ${normalized.slice(2, 4)} ${normalized.slice(4, 7)} ${normalized.slice(7)}`;
}
