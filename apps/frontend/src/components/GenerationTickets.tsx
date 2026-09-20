import { useState } from 'react';
import { formatDuration } from '../api/user-manager';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ticketGenerationApi,
  type CibleGeneration,
  type GenerationResultat,
} from '../api/ticket-generation';
import { Badge, Button, Card, ErrorNote, FormField, Input } from './ui';

/**
 * Générer des tickets pour un profil, directement sur le routeur.
 *
 * L'équivalent du « Generate Voucher » de WinBox. Il sert le cas que les lots
 * de l'écran Tickets ne couvrent pas : un profil qui existe sur le routeur
 * sans offre correspondante dans l'application.
 *
 * L'écran le dit franchement, parce que la différence coûte cher si on
 * l'ignore : ces tickets ne sont **pas suivis** comme des ventes. Ils
 * ouvriront l'accès, mais aucun encaissement ne leur sera rattaché et ils
 * apparaîtront « hors application ».
 */
export function GenerationTickets({
  routerId,
  cible,
  profileName,
  onFermer,
}: {
  routerId: string;
  cible: CibleGeneration;
  profileName: string;
  onFermer: () => void;
}) {
  const client = useQueryClient();
  const [quantite, setQuantite] = useState('10');
  const [prefixe, setPrefixe] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [resultat, setResultat] = useState<GenerationResultat | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const generer = useMutation({
    mutationFn: () =>
      ticketGenerationApi.generer(routerId, {
        cible,
        profileName,
        quantite: Number(quantite),
        ...(prefixe.trim() ? { prefixe: prefixe.trim() } : {}),
        ...(commentaire.trim() ? { commentaire: commentaire.trim() } : {}),
      }),
    onSuccess: (r) => {
      setResultat(r);
      setErreur(null);
      // Les deux tables peuvent avoir changé : les comptes créés, et le
      // nombre d'attributions porté par le profil.
      void client.invalidateQueries({ queryKey: ['um-accounts'] });
      void client.invalidateQueries({ queryKey: ['um-profiles'] });
      void client.invalidateQueries({ queryKey: ['hotspot-users'] });
    },
    onError: (e: unknown) => setErreur(e instanceof Error ? e.message : String(e)),
  });

  const n = Number(quantite);
  const quantiteValide = Number.isInteger(n) && n >= 1 && n <= 200;

  if (resultat) {
    return (
      <Card title={`${resultat.codes.length} ticket(s) créé(s) — ${profileName}`}>
        {/* Le plafond cumulé est ce qui borne réellement un ticket HotSpot :
            le `session-timeout` du profil repart à zéro à chaque reconnexion,
            et le cookie rend cette reconnexion automatique. Le dire ici, c'est
            permettre de s'apercevoir tout de suite qu'un profil n'en porte
            pas — 228 tickets invendus étaient dans ce cas sur ce parc. */}
        {/* La planche compte autant que les codes : c'est elle qu'on imprime.
            Elle vit sur le routeur, pas ici — il faut donc dire où. */}
        {(resultat.planches?.length ?? 0) > 0 && (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
            <strong>
              {resultat.planches!.length} planche(s) A4 écrite(s) sur le routeur
            </strong>{' '}
            — à récupérer dans WinBox, onglet Files :
            <ul className="mt-1 font-mono text-xs">
              {resultat.planches!.map((p) => (
                <li key={p.chemin}>
                  {p.chemin} <span className="text-emerald-700">({p.tickets} tickets)</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(resultat.planchesEnEchec?.length ?? 0) > 0 && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <strong>Les comptes sont bien créés</strong>, mais la planche n'a pas pu être écrite
            sur le routeur : {resultat.planchesEnEchec![0].motif}. Les codes ci-dessous restent
            valables, et l'écran « Imprimer » sait toujours produire la feuille.
          </div>
        )}

        {resultat.cible === 'hotspot' &&
          (resultat.plafondCumule ? (
            <p className="mb-3 text-sm text-slate-600">
              Chaque ticket est borné à <strong>{formatDuration(resultat.plafondCumule)}</strong>{' '}
              de temps cumulé, repris de la durée du profil.
            </p>
          ) : (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              Le profil « {profileName} » ne porte <strong>aucune durée</strong> : ces tickets
              partent sans plafond de temps cumulé. Le seul garde-fou sera la durée de session du
              profil, qui <strong>repart à zéro à chaque reconnexion</strong>.
            </p>
          ))}
        {resultat.echecs.length > 0 && (
          <div className="mb-3">
            <ErrorNote>
              {resultat.echecs.length} sur {resultat.codes.length + resultat.echecs.length} n'ont
              pas abouti. Un compte sans forfait n'ouvre rien : ceux-ci sont à reprendre.
              <span className="mt-1 block font-mono text-xs">
                {resultat.echecs.map((e) => e.code).join(', ')}
              </span>
            </ErrorNote>
          </div>
        )}

        <p className="mb-2 text-sm text-slate-600">
          Les codes sont déjà sur le routeur et fonctionnent. Copiez-les maintenant : le mot de
          passe est identique au code, et le routeur ne le rendra plus en clair ensuite.
        </p>

        <textarea
          readOnly
          rows={Math.min(12, Math.max(3, resultat.codes.length))}
          value={resultat.codes.join('\n')}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              void navigator.clipboard?.writeText(resultat.codes.join('\n'));
            }}
          >
            Copier les codes
          </Button>
          <Button variant="secondary" onClick={() => setResultat(null)}>
            En générer d'autres
          </Button>
          <Button variant="secondary" onClick={onFermer}>
            Fermer
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title={`Générer des tickets — ${profileName}`}>
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Ces tickets ne seront <strong>pas suivis comme des ventes</strong> : aucun prix, aucun
        encaissement rattaché, et ils apparaîtront « hors application ». Pour de la vente suivie,
        passez par{' '}
        <Link to="/vouchers" className="font-medium underline">
          Tickets ▸ Générer un lot
        </Link>
        , qui part d'une offre.
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          generer.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Quantité">
            <Input
              type="number"
              min="1"
              max="200"
              value={quantite}
              onChange={(e) => setQuantite(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Préfixe (facultatif)">
            {/* Un préfixe rend le lot reconnaissable sur le routeur, là où
                des codes purement aléatoires se mêlent aux anciens. */}
            <Input
              value={prefixe}
              onChange={(e) => setPrefixe(e.target.value)}
              placeholder="ex. SEP-"
              maxLength={16}
            />
          </FormField>
          <FormField label="Commentaire (facultatif)">
            <Input
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              placeholder="Ticket 500Ar"
            />
          </FormField>
        </div>

        <p className="text-xs text-slate-500">
          Cible : <Badge tone="slate">{cible === 'user-manager' ? 'User Manager' : 'HotSpot'}</Badge>{' '}
          {cible === 'user-manager'
            ? "— la validité sera calendaire, elle court même client déconnecté."
            : '— le plafond comptera le temps passé connecté, pas les jours.'}{' '}
          Au-delà de 200 d'un coup, la requête dépasserait son délai ; faites plusieurs lots.
        </p>

        {erreur && <ErrorNote>{erreur}</ErrorNote>}

        <div className="flex gap-2">
          <Button type="submit" disabled={generer.isPending || !quantiteValide}>
            {generer.isPending ? 'Création sur le routeur…' : `Générer ${quantiteValide ? n : ''}`}
          </Button>
          <Button type="button" variant="secondary" onClick={onFermer}>
            Annuler
          </Button>
        </div>
      </form>
    </Card>
  );
}
