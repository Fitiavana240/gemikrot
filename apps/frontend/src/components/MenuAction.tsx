import { useState } from 'react';
import { Modale } from './Modale';
import { Button, FormField, Input } from './ui';

/**
 * Choisir **un** geste sur une ligne, au lieu de les avoir tous sous le doigt.
 *
 * Chaque ligne portait ses boutons côte à côte — « Changer le code »,
 * « Suspendre », « Supprimer » — dont deux rouges, séparés de quelques
 * pixels. Supprimer et bloquer étaient à la même portée de clic alors que
 * l'un se défait et l'autre non.
 *
 * Ici on choisit d'abord, on lit ce que le geste fait, puis on applique. Le
 * bouton prend le nom et la couleur du choix : on ne clique jamais
 * « Appliquer » sans avoir lu « Supprimer définitivement » juste avant.
 */

export type OptionAction = {
  clé: string;
  libellé: string;
  /** Ce que le geste fait **et ne fait pas**. C'est là qu'il se comprend. */
  aide: string;
  /** Rouge, et bouton nommé : un geste qui ne se défait pas. */
  danger?: boolean;
  /** Le nom du bouton une fois ce choix fait. À défaut, le libellé. */
  libelléBouton?: string;
  /** Un champ qui n'apparaît que pour ce choix — un code à saisir, p. ex. */
  champ?: {
    libellé: string;
    placeholder?: string;
    type?: 'text' | 'password';
    /** Message affiché si la valeur ne convient pas. */
    valider?: (valeur: string) => string | null;
  };
};

export function MenuAction({
  titre,
  options,
  onAppliquer,
  onFermer,
  enCours = false,
  erreur,
}: {
  titre: string;
  options: OptionAction[];
  /** `valeur` n'est rempli que pour un choix qui porte un champ. */
  onAppliquer: (clé: string, valeur: string) => void;
  onFermer: () => void;
  enCours?: boolean;
  erreur?: string | null;
}) {
  // Aucun choix par défaut : présélectionner ferait d'un clic distrait sur
  // « Appliquer » un geste qu'on n'a pas voulu, et le premier de la liste
  // n'est pas plus légitime qu'un autre.
  const [choisi, setChoisi] = useState<string | null>(null);
  const [valeur, setValeur] = useState('');
  const [refus, setRefus] = useState<string | null>(null);

  const option = options.find((o) => o.clé === choisi) ?? null;

  const appliquer = () => {
    if (!option) return;
    const message = option.champ?.valider?.(valeur) ?? null;
    setRefus(message);
    if (message) return;
    onAppliquer(option.clé, valeur.trim());
  };

  return (
    <Modale
      titre={titre}
      onFermer={onFermer}
      actions={
        <Button
          // Sans choix, le bouton ne promet rien : il le dit et reste inerte.
          disabled={!option || enCours}
          variant={option?.danger ? 'danger' : 'primary'}
          onClick={appliquer}
        >
          {enCours
            ? 'En cours…'
            : option
              ? (option.libelléBouton ?? option.libellé)
              : 'Choisissez une action'}
        </Button>
      }
      note={
        erreur ? (
          <span className="text-red-700">
            <strong>Le routeur a refusé.</strong> Rien n&apos;a été changé. {erreur}
          </span>
        ) : (
          <>
            Rien n&apos;est envoyé au routeur tant que vous n&apos;avez pas appliqué. Un seul
            geste à la fois — pour en faire un sur plusieurs comptes, cochez-les dans la liste.
          </>
        )
      }
    >
      <div className="space-y-1">
        {options.map((o) => (
          <div key={o.clé}>
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
                choisi === o.clé
                  ? o.danger
                    ? 'border-red-300 bg-red-50'
                    : 'border-sky-300 bg-sky-50'
                  : 'border-transparent hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="action-ligne"
                checked={choisi === o.clé}
                onChange={() => {
                  setChoisi(o.clé);
                  setValeur('');
                  setRefus(null);
                }}
                className="mt-0.5 h-4 w-4 cursor-pointer border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span>
                <span
                  className={`block text-sm font-medium ${
                    o.danger ? 'text-red-800' : 'text-slate-800'
                  }`}
                >
                  {o.libellé}
                </span>
                {/* La conséquence sous le nom, toujours visible : la cacher
                    derrière le choix obligerait à essayer pour comprendre. */}
                <span className="mt-0.5 block text-xs text-slate-600">{o.aide}</span>
              </span>
            </label>

            {choisi === o.clé && o.champ && (
              <div className="mb-1 ml-9 mr-3">
                <FormField label={o.champ.libellé}>
                  <Input
                    type={o.champ.type ?? 'text'}
                    value={valeur}
                    placeholder={o.champ.placeholder}
                    autoFocus
                    onChange={(e) => {
                      setValeur(e.target.value);
                      setRefus(null);
                    }}
                  />
                </FormField>
                {refus && <p className="mt-1 text-sm text-red-600">{refus}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modale>
  );
}
