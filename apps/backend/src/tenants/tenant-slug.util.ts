/**
 * Identifiant public d'un exploitant, tel qu'il apparaît dans l'adresse de
 * sa page de paiement : `/p/zone-wifi-tati`.
 *
 * Un slug plutôt qu'une résolution par domaine : il est déterministe, il
 * fonctionne en développement où l'hôte est `localhost`, et il ne dépend pas
 * d'un DNS que l'exploitant n'a pas forcément configuré.
 */
export function slugifyTenantName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  // Un nom entièrement non latin ne laisserait rien : mieux vaut un
  // identifiant quelconque qu'une adresse vide.
  return slug || 'exploitant';
}

/**
 * Rend le slug unique en le suffixant. `exists` interroge la base — la
 * vérification ne peut pas être purement locale, un autre exploitant ayant
 * pu prendre le même nom.
 */
export async function reserveTenantSlug(
  name: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugifyTenantName(name);
  if (!(await exists(base))) return base;

  for (let suffix = 2; suffix <= 50; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await exists(candidate))) return candidate;
  }

  // Cinquante homonymes : on cesse de compter et on tire au sort.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
