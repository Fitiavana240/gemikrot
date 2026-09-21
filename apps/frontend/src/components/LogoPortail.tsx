import { useRef, useState } from 'react';
import { Button } from './ui';

/**
 * Le logo de la page captive, réduit avant d'être envoyé.
 *
 * Une adresse d'image ne marche que si son hôte est autorisé dans le Walled
 * Garden : sinon le client voit un cadre vide, et personne ne comprend
 * pourquoi. L'image **embarquée dans la page** ne dépend de rien — elle
 * s'affiche même serveur arrêté, ce qui est la seule promesse tenable pour
 * une page de connexion.
 *
 * **La réduction se fait dans le navigateur**, pas sur le serveur. Une photo
 * de 4 Mo prise au téléphone traverserait le réseau pour être jetée à
 * l'arrivée, et redimensionner côté serveur demanderait une bibliothèque
 * native de plus à installer et à maintenir. Le `canvas` fait le même travail
 * là où la photo se trouve déjà.
 *
 * PNG d'abord, pour garder la transparence d'un logo. S'il dépasse le budget,
 * JPEG sur fond blanc : un logo lourd vaut mieux qu'un logo absent.
 */

/** Le côté de la vignette produite. Au-delà, on paie des pixels invisibles. */
const COTE = 128;

/** Ce que le résultat a le droit de peser une fois embarqué, en caractères. */
const BUDGET = 40_000;

async function reduire(fichier: File): Promise<string> {
  const image = await chargerImage(fichier);

  // Le rapport est conservé : un logo étiré est pire qu'un logo petit.
  const facteur = Math.min(COTE / image.width, COTE / image.height, 1);
  const largeur = Math.max(1, Math.round(image.width * facteur));
  const hauteur = Math.max(1, Math.round(image.height * facteur));

  const toile = document.createElement('canvas');
  toile.width = largeur;
  toile.height = hauteur;
  const pinceau = toile.getContext('2d');
  if (!pinceau) throw new Error("Ce navigateur ne sait pas redimensionner l'image.");
  pinceau.drawImage(image, 0, 0, largeur, hauteur);

  const png = toile.toDataURL('image/png');
  if (png.length <= BUDGET) return png;

  // Trop lourd en PNG : on repasse sur fond blanc, sans quoi la transparence
  // deviendrait noire en JPEG.
  pinceau.globalCompositeOperation = 'destination-over';
  pinceau.fillStyle = '#ffffff';
  pinceau.fillRect(0, 0, largeur, hauteur);
  for (const qualite of [0.82, 0.68, 0.55]) {
    const jpeg = toile.toDataURL('image/jpeg', qualite);
    if (jpeg.length <= BUDGET) return jpeg;
  }
  throw new Error(
    "Cette image reste trop lourde même réduite. Essayez un logo plus simple, sans dégradé ni photo.",
  );
}

function chargerImage(fichier: File): Promise<HTMLImageElement> {
  return new Promise((resoudre, rejeter) => {
    const url = URL.createObjectURL(fichier);
    const image = new Image();
    image.onload = () => {
      // Libéré dès le chargement : sans cela, le contenu du fichier reste en
      // mémoire tant que l'onglet est ouvert.
      URL.revokeObjectURL(url);
      resoudre(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      rejeter(new Error("Ce fichier n'est pas une image que le navigateur sait lire."));
    };
    image.src = url;
  });
}

export function LogoPortail({
  valeur,
  onChange,
}: {
  valeur: string | null;
  onChange: (valeur: string) => void;
}) {
  const champ = useRef<HTMLInputElement>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const embarque = (valeur ?? '').startsWith('data:image/');
  const poids = embarque ? Math.round((valeur ?? '').length / 1024) : null;

  async function choisir(fichier: File | undefined) {
    if (!fichier) return;
    setErreur(null);
    setEnCours(true);
    try {
      onChange(await reduire(fichier));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "L'image n'a pas pu être préparée.");
    } finally {
      setEnCours(false);
      // Vidé pour que choisir deux fois le même fichier déclenche bien le
      // second changement.
      if (champ.current) champ.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {valeur ? (
          <img
            src={valeur}
            alt=""
            className="h-14 w-14 rounded border border-slate-200 bg-white object-contain p-1"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">
            aucun
          </div>
        )}
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={enCours}
              onClick={() => champ.current?.click()}
            >
              {enCours ? 'Préparation…' : valeur ? 'Changer' : 'Envoyer une image'}
            </Button>
            {valeur && (
              <Button variant="secondary" onClick={() => onChange('')}>
                Retirer
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {embarque ? (
              <>
                Réduite à {COTE} px et <strong>embarquée dans la page</strong> ({poids} Ko) :
                elle s&apos;affiche sans réseau.
              </>
            ) : valeur ? (
              <>
                Adresse externe : son hôte doit être autorisé dans le Walled Garden, sinon le
                client verra un cadre vide.
              </>
            ) : (
              <>PNG, JPEG ou WebP. L&apos;image est réduite automatiquement avant l&apos;envoi.</>
            )}
          </p>
        </div>
      </div>

      <input
        ref={champ}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void choisir(e.target.files?.[0])}
      />

      {erreur && <p className="text-xs text-red-700">{erreur}</p>}
    </div>
  );
}
