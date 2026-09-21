import { useState, type ReactNode } from 'react';
import { Button, FormField, Input } from './ui';
import { Modale } from './Modale';

/**
 * Deux panneaux qui remplacent `window.prompt` et `window.confirm`.
 *
 * Les boîtes natives marchent, et c'est leur seul mérite. Elles ignorent la
 * charte, s'affichent en pleine largeur sur un téléphone, et surtout elles
 * écrasent en texte minuscule ce qui compte le plus : **ce que le geste
 * change**. Un vendeur au comptoir lit « Nouvelle validité en jours ? » sans
 * voir que les tickets déjà attribués n'en profiteront pas.
 *
 * Certains navigateurs proposent en prime de « bloquer les dialogues de cette
 * page » après quelques-uns — l'action disparaît alors sans rien dire.
 */

/**
 * Confirmation d'un geste qu'on ne peut pas reprendre.
 *
 * Elle **nomme ce qu'on perd** plutôt que de demander « êtes-vous sûr ». La
 * question n'apprend rien ; la conséquence, si.
 *
 * En fenêtre, comme tous les formulaires : posée dans le flux de la page,
 * elle apparaissait quelque part au-dessus de la liste, parfois hors de
 * l'écran sur une table longue — on cliquait « Supprimer » et il ne se
 * passait rien de visible.
 *
 * `erreur` compte autant que le reste. Un refus du routeur s'affichait
 * jusqu'ici dans un bandeau en haut de page, **derrière** la fenêtre, et
 * l'appelant refermait souvent avant de savoir si le geste avait abouti :
 * on lisait « c'est fait » pour une opération qui avait échoué. La fenêtre
 * reste donc ouverte tant que le geste n'a pas réussi, et porte le refus.
 */
export function Confirmation({
  titre,
  children,
  libelléConfirmer = 'Confirmer',
  onConfirmer,
  onAnnuler,
  enCours = false,
  erreur,
}: {
  titre: string;
  children: ReactNode;
  libelléConfirmer?: string;
  onConfirmer: () => void;
  onAnnuler: () => void;
  enCours?: boolean;
  /** Le refus du routeur, montré ici plutôt que derrière la fenêtre. */
  erreur?: ReactNode;
}) {
  return (
    <Modale
      titre={titre}
      onFermer={onAnnuler}
      actions={
        <Button variant="danger" onClick={onConfirmer} disabled={enCours}>
          {enCours ? 'En cours…' : libelléConfirmer}
        </Button>
      }
      note={
        erreur ? (
          <span className="text-red-700">
            <strong>Le routeur a refusé.</strong> Rien n&apos;a été changé. {erreur}
          </span>
        ) : (
          <>Rien n&apos;est envoyé au routeur tant que vous n&apos;avez pas confirmé.</>
        )
      }
    >
      <div className="max-w-3xl text-sm text-slate-700">{children}</div>
    </Modale>
  );
}


/** Les unités d'une durée, de la plus fine à la plus grosse. */
const UNITÉS = [
  { clé: 'minutes', libellé: 'minutes', secondes: 60 },
  { clé: 'heures', libellé: 'heures', secondes: 3600 },
  { clé: 'jours', libellé: 'jours', secondes: 86_400 },
] as const;

/**
 * L'unité qui donne le nombre le plus lisible pour cette durée.
 *
 * Imposer les jours affichait « 0.0104 » pour un profil de quinze minutes —
 * un champ qu'on ne peut ni lire ni corriger. Le parc va de 15 min à 30 j :
 * une seule unité ne peut pas servir les deux bouts.
 */
function unitéNaturelle(secondes: number): (typeof UNITÉS)[number] {
  // La plus grosse unité qui tombe juste, sinon la plus grosse qui donne au
  // moins 1 — mieux vaut « 90 minutes » que « 1.5 heures ».
  const juste = [...UNITÉS].reverse().find((u) => secondes % u.secondes === 0);
  return juste ?? UNITÉS[0];
}

/**
 * Un champ de durée : un nombre et son unité, pour n'importe quel formulaire.
 *
 * Extrait plutôt que recopié — la conversion et le choix de l'unité sont la
 * partie qu'on aurait fini par écrire deux fois différemment.
 *
 * `null` veut dire « rien de saisi ». Un plafond ou une validité absents ne
 * sont pas la même chose que zéro, et l'appelant doit pouvoir les distinguer.
 */
export function ChampDuree({
  secondes,
  onChange,
  autoFocus,
  placeholder,
}: {
  secondes: number | null;
  onChange: (secondes: number | null) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const départ = unitéNaturelle(secondes ?? 86_400);
  const [unité, setUnité] = useState<string>(départ.clé);
  const [valeur, setValeur] = useState(secondes ? String(secondes / départ.secondes) : '');

  const facteur = UNITÉS.find((u) => u.clé === unité)?.secondes ?? 86_400;

  const poser = (texte: string, facteurUnité: number) => {
    setValeur(texte);
    const nombre = Number(texte.replace(',', '.'));
    onChange(texte.trim() === '' || !Number.isFinite(nombre) || nombre <= 0
      ? null
      : Math.round(nombre * facteurUnité));
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        step="any"
        min="0"
        value={valeur}
        onChange={(e) => poser(e.target.value, facteur)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-32"
      />
      <select
        value={unité}
        onChange={(e) => {
          // Convertir plutôt que réinitialiser : passer de jours à heures
          // doit garder la même durée, pas vider le champ.
          const nouveau = UNITÉS.find((u) => u.clé === e.target.value)?.secondes ?? 86_400;
          const nombre = Number(valeur.replace(',', '.'));
          setUnité(e.target.value);
          if (Number.isFinite(nombre) && nombre > 0) {
            poser(String((nombre * facteur) / nouveau), nouveau);
          }
        }}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
      >
        {UNITÉS.map((u) => (
          <option key={u.clé} value={u.clé}>
            {u.libellé}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Modification d'une durée : le champ ci-dessus, dans un panneau qui a la
 * place d'expliquer la portée du changement.
 */
export function EditionDuree({
  titre,
  description,
  libellé,
  secondesInitiales,
  onValider,
  onAnnuler,
  enCours = false,
}: {
  titre: string;
  description: ReactNode;
  libellé: string;
  secondesInitiales: number | null;
  /** Renvoyer un message laisse le panneau ouvert et l'affiche. */
  onValider: (secondes: number) => string | null | void;
  onAnnuler: () => void;
  enCours?: boolean;
}) {
  const [secondes, setSecondes] = useState<number | null>(secondesInitiales);
  const [erreur, setErreur] = useState<string | null>(null);

  const valider = () => {
    if (secondes == null) {
      setErreur('Indiquez une durée supérieure à zéro.');
      return;
    }
    const refus = onValider(secondes);
    setErreur(typeof refus === 'string' ? refus : null);
  };

  return (
    <Modale
      titre={titre}
      onFermer={onAnnuler}
      // La portée du geste passe en bas : on la lit une fois la valeur
      // saisie, juste avant de valider — c'est là qu'elle sert.
      note={description}
      actions={
        <Button disabled={enCours} onClick={valider}>
          {enCours ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          valider();
        }}
      >
        <FormField label={libellé}>
          <ChampDuree secondes={secondesInitiales} onChange={setSecondes} autoFocus />
        </FormField>

        {erreur && <p className="text-sm text-red-600">{erreur}</p>}
        {/* Entrée valide : sans ce bouton caché, la touche ne ferait rien
            dans un formulaire dont le bouton vit hors du <form>. */}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modale>
  );
}

/**
 * Modification d'une seule valeur, avec la place d'expliquer sa portée.
 *
 * Un champ suffit à la plupart des réglages d'un routeur — une validité, un
 * débit, un code. Ce qui manquait n'était pas l'espace de saisie mais celui
 * de dire ce que la valeur commande, et jusqu'où.
 */
export function EditionUnChamp({
  titre,
  description,
  libellé,
  unité,
  valeurInitiale = '',
  type = 'text',
  placeholder,
  onValider,
  onAnnuler,
  enCours = false,
}: {
  titre: string;
  /** Ce que le geste change réellement, et ce qu'il ne change pas. */
  description: ReactNode;
  libellé: string;
  /** Affichée à côté du champ : « jours », « Mb/s »… */
  unité?: string;
  valeurInitiale?: string;
  type?: 'text' | 'number' | 'password';
  placeholder?: string;
  /** Renvoyer un message d'erreur laisse le panneau ouvert et l'affiche. */
  onValider: (valeur: string) => string | null | void;
  onAnnuler: () => void;
  enCours?: boolean;
}) {
  const [valeur, setValeur] = useState(valeurInitiale);
  const [erreur, setErreur] = useState<string | null>(null);

  // Le refus vient de l'appelant, qui seul connaît les bornes. La fenêtre
  // reste ouverte : la refermer obligerait à tout ressaisir.
  const valider = () => {
    const refus = onValider(valeur);
    setErreur(typeof refus === 'string' ? refus : null);
  };

  return (
    <Modale
      titre={titre}
      onFermer={onAnnuler}
      note={description}
      actions={
        <Button disabled={enCours} onClick={valider}>
          {enCours ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          valider();
        }}
      >
        <FormField label={libellé}>
          <div className="flex items-center gap-2">
            <Input
              type={type}
              value={valeur}
              onChange={(e) => setValeur(e.target.value)}
              placeholder={placeholder}
              autoFocus
              className="w-48"
            />
            {unité && <span className="text-sm text-slate-500">{unité}</span>}
          </div>
        </FormField>

        {erreur && <p className="text-sm text-red-600">{erreur}</p>}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modale>
  );
}
