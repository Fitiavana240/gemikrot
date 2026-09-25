import { describe, expect, it } from 'vitest';
import { navPourRole, rolesRequis } from './nav';

/**
 * **Comment lancer ces epreuves.** Le frontend n'a pas encore de lanceur ; on
 * emprunte celui du serveur en changeant sa racine, depuis la racine du
 * depot :
 *
 *     ./apps/backend/node_modules/.bin/vitest run --root apps/frontend
 *
 * Ajouter `vitest` aux dependances du frontend toucherait au verrou de
 * dependances, au milieu d'un deploiement en cours. Cette ligne coute moins
 * cher et ne se perd pas.
 *
 * Verrouiller et cacher ne disent pas la meme chose.
 *
 * Un vendeur a qui l'on cache << Offres >> croit le produit plus pauvre qu'il
 * n'est, et ne demande rien. Un cadenas lui dit que la chose existe et
 * appartient a son exploitant -- il sait a qui s'adresser.
 *
 * Mais << Exploitants >> et << Supervision >> n'appartiennent a aucun
 * exploitant : ce sont les ecrans de la plateforme. Y mettre un cadenas
 * annoncerait a chaque client l'existence d'une console au-dessus de la
 * sienne, et le detail de ce qu'elle voit.
 */

const entrées = (role: Parameters<typeof navPourRole>[0]) =>
  navPourRole(role).flatMap((g) => g.items);

const trouver = (role: Parameters<typeof navPourRole>[0], to: string) =>
  entrées(role).find((i) => i.to === to);

describe('le menu selon le rôle', () => {
  it('verrouille pour le vendeur ce qui appartient à son exploitant', () => {
    // « Offres » est reserve a l'exploitant : le vendeur doit la voir fermee.
    expect(trouver('OPERATOR', '/plans')).toMatchObject({ verrouillé: true });
    expect(trouver('OPERATOR', '/routers')).toMatchObject({ verrouillé: true });
  });

  it('laisse ouvert au vendeur ce qui est son métier', () => {
    expect(trouver('OPERATOR', '/vouchers')).toMatchObject({ verrouillé: false });
    expect(trouver('OPERATOR', '/payments')).toMatchObject({ verrouillé: false });
  });

  it('cache au client les écrans de la plateforme', () => {
    // Pas de cadenas : ce serait annoncer l'existence d'une console au-dessus.
    expect(trouver('ADMIN', '/tenants')).toBeUndefined();
    expect(trouver('ADMIN', '/supervision')).toBeUndefined();
    expect(trouver('OPERATOR', '/tenants')).toBeUndefined();
  });

  it('cache à la plateforme ce qui ne la concerne pas', () => {
    // Le SUPER_ADMIN n'appartient a aucun exploitant : son abonnement n'existe
    // pas. Ce n'est pas un refus, c'est une question qui ne se pose pas.
    expect(trouver('SUPER_ADMIN', '/abonnement')).toBeUndefined();
  });

  it('n’ouvre rien de plus à l’exploitant qu’avant', () => {
    expect(trouver('ADMIN', '/plans')).toMatchObject({ verrouillé: false });
    expect(trouver('ADMIN', '/tenants')).toBeUndefined();
  });

  it('le cadenas n’ouvre aucune porte : la garde lit la même déclaration', () => {
    // C'est le point qui rend le cadenas sans danger. Le menu montre, le
    // serveur refuse, et les deux lisent la meme liste.
    expect(rolesRequis('/plans')).toContain('ADMIN');
    expect(rolesRequis('/plans')).not.toContain('OPERATOR');
    expect(rolesRequis('/tenants')).toEqual(['SUPER_ADMIN']);
  });

  it('ne laisse aucun groupe vide au menu', () => {
    for (const role of ['ADMIN', 'OPERATOR', 'SUPER_ADMIN'] as const) {
      for (const groupe of navPourRole(role)) {
        expect(groupe.items.length).toBeGreaterThan(0);
      }
    }
  });
});
