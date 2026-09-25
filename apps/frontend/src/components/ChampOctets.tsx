import { useState } from 'react';
import { Input, Select } from './ui';

/** Ce que l'exploitant tape, et ce que le routeur compte. */
const UNITÉS = [
  { clé: 'Mo', facteur: 1_000_000 },
  { clé: 'Go', facteur: 1_000_000_000 },
] as const;

type Unité = (typeof UNITÉS)[number]['clé'];

/**
 * Une limite de données, saisie dans l'unité où elle se vend.
 *
 * **Base 1000 et non 1024.** C'est ce que disent les forfaits vendus à
 * Toliara, et ce que le client croit acheter en payant « 2 Go ». Compter en
 * 1024 lui donnerait 7 % de plus sans que personne ne l'ait décidé — et
 * l'écart se voit sur la facture d'un exploitant qui revend de la bande
 * passante.
 *
 * **Vide veut dire « sans limite », et pas zéro.** Une limite de zéro octet
 * rendrait le ticket inutilisable dès le premier paquet ; c'est exactement le
 * genre de valeur qu'un champ numérique produit quand on l'efface, et elle
 * partirait sur le routeur sans que rien ne la rattrape.
 *
 * L'unité est choisie à l'affichage : une limite de 2 000 000 000 octets se
 * relit « 2 Go », pas « 2000 Mo ».
 */
export function ChampOctets({
  octets,
  onChange,
}: {
  octets: number | undefined;
  onChange: (octets: number | undefined) => void;
}) {
  /**
   * **Le texte tapé vit ici, et non recalculé depuis la valeur.**
   *
   * Dérivé à chaque rendu, le champ détruisait ce qu'on était en train
   * d'écrire : taper « 1,5 » redonnait « 1 » dès la virgule, parce que
   * `Number('1,')` vaut 1 et que 1 Go se réaffiche « 1 ». La virgule était
   * avalée à chaque frappe et le champ n'acceptait que des entiers, sans que
   * rien ne le dise. Trouvé en tapant, pas en relisant.
   *
   * L'état initial est dérivé une fois : le gigaoctet s'il tombe juste, le
   * mégaoctet sinon — 1 500 000 000 se relit « 1500 Mo », pas « 1.5 Go ».
   */
  const [texte, setTexte] = useState(() => {
    if (!octets) return '';
    const enGo = octets / 1_000_000_000;
    return Number.isInteger(enGo) ? String(enGo) : String(octets / 1_000_000);
  });
  const [unité, setUnité] = useState<Unité>(() =>
    octets && Number.isInteger(octets / 1_000_000_000) ? 'Go' : octets ? 'Mo' : 'Go',
  );

  function poser(brut: string, u: Unité) {
    setTexte(brut);
    setUnité(u);
    const n = Number(brut.replace(',', '.'));
    if (!brut.trim() || !Number.isFinite(n) || n <= 0) {
      onChange(undefined);
      return;
    }
    const facteur = UNITÉS.find((x) => x.clé === u)?.facteur ?? 1_000_000_000;
    onChange(Math.round(n * facteur));
  }

  return (
    <div className="flex gap-2">
      <Input
        type="number"
        min={0}
        step="0.1"
        placeholder="sans limite"
        value={texte}
        onChange={(e) => poser(e.target.value, unité)}
        className="min-w-0 flex-1"
      />
      <Select
        value={unité}
        onChange={(e) => poser(texte, e.target.value as Unité)}
        className="w-24 shrink-0"
        aria-label="Unité"
      >
        {UNITÉS.map((u) => (
          <option key={u.clé} value={u.clé}>
            {u.clé}
          </option>
        ))}
      </Select>
    </div>
  );
}
