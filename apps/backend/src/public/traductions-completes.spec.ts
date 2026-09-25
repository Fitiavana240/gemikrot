import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Les deux langues de la page de paiement disent-elles la même chose ?
 *
 * Cette page s'adresse aux clients de Toliara, qui lisent plus facilement le
 * malgache que le français. Une clé ajoutée au français seul ne casse rien
 * chez nous — on développe en français — et affiche `undefined` chez **eux**,
 * sur la page où ils décident de payer. Le défaut est invisible du côté d'où
 * on le crée : c'est ce qui le rend durable.
 *
 * L'épreuve vit côté serveur parce que c'est là que les tests tournent, et
 * qu'elle ne coûte alors ni dépendance ni configuration. Elle lit le fichier,
 * comme les autres gardes de ce dépôt.
 */

const TRADUCTIONS = resolve(
  __dirname,
  '../../../frontend/src/pages/public/translations.ts',
);

/** Les clés d'un bloc de langue, dans l'ordre où elles y figurent. */
function clesDuBloc(source: string, langue: string): string[] {
  const debut = source.indexOf(`  ${langue}: {`);
  if (debut === -1) throw new Error(`Bloc « ${langue} » introuvable`);
  // Jusqu'à la fermeture du bloc, repérée à son indentation : les accolades
  // internes d'un littéral de gabarit ne trompent pas ce repère.
  const fin = source.indexOf('\n  },', debut);
  const bloc = source.slice(debut, fin === -1 ? undefined : fin);
  return [...new Set((bloc.match(/^\s{4}([a-zA-Z][a-zA-Z0-9]*):/gm) ?? []).map((m) => m.trim().replace(':', '')))];
}

describe('les traductions de la page de paiement', () => {
  const source = readFileSync(TRADUCTIONS, 'utf8');

  it('portent les mêmes clés en français et en malgache', () => {
    const fr = clesDuBloc(source, 'fr');
    const mg = clesDuBloc(source, 'mg');

    expect(fr.length).toBeGreaterThan(10);
    // Nommer les manquantes : « les tableaux diffèrent » n'aide personne à
    // trouver laquelle.
    expect(fr.filter((k) => !mg.includes(k))).toEqual([]);
    expect(mg.filter((k) => !fr.includes(k))).toEqual([]);
  });

  it('disent quoi faire quand rien n’est en vente', () => {
    // Le cas arrive à toute nouvelle installation, et après toute remise à
    // zéro de la base. Un tiret y tenait lieu de réponse.
    for (const cle of ['noOfferTitle', 'noOfferBody', 'noAccountTitle', 'noAccountBody']) {
      expect(clesDuBloc(source, 'fr')).toContain(cle);
      expect(clesDuBloc(source, 'mg')).toContain(cle);
    }
  });
});
