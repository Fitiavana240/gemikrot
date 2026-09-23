import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { enrollmentsApi, type RaccordementAssiste as Resultat, type SondageRouteur } from '../api/routers';
import { ApiError } from '../api/client';
import { Modale } from './Modale';
import { Button, FormField, Input } from './ui';

/**
 * Raccorder un routeur sans coller une seule ligne dans Winbox.
 *
 * Le parcours par script a le mérite d'être transparent, et il reste
 * disponible. Mais il échoue de bien des façons chez quelqu'un qui n'est pas
 * informaticien : une ligne perdue au collage, un `/tool/fetch` qui bloque et
 * avale la suite, un terminal qui rend les accents en mojibake. Les trois sont
 * arrivés ici en une seule séance.
 *
 * **Trois temps, et le premier n'écrit rien.** On regarde le routeur, on
 * montre ce qu'on a trouvé — son nom, son modèle, sa version — et l'exploitant
 * confirme que c'est bien le sien. Poser un tunnel sur un routeur qu'on n'a
 * pas identifié laisserait une configuration à moitié écrite sur le matériel
 * de quelqu'un.
 *
 * **Le mot de passe ne quitte pas cet écran.** Il part au serveur, qui s'en
 * sert le temps de trois écritures et ne l'enregistre nulle part. C'est dit à
 * l'écran, parce que demander le mot de passe administrateur d'un routeur en
 * production sans expliquer ce qu'on en fait serait indécent.
 */

/** L'adresse d'usine d'un MikroTik, et celle de neuf routeurs sur dix. */
const HOTE_PAR_DEFAUT = '192.168.88.1';

function Pastille({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        ok
          ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
          : 'border-red-300 bg-red-50 text-red-900'
      }`}
    >
      {children}
    </div>
  );
}

export function RaccordementAssisteModale({
  onFermer,
  onFini,
}: {
  onFermer: () => void;
  onFini: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    host: HOTE_PAR_DEFAUT,
    port: '443',
    username: 'admin',
    password: '',
    label: '',
  });
  const [sondage, setSondage] = useState<SondageRouteur | null>(null);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const entree = () => ({
    host: form.host.trim(),
    port: Number(form.port) || 443,
    username: form.username.trim(),
    password: form.password,
    label: form.label.trim() || undefined,
  });

  const sonder = useMutation({
    mutationFn: () => enrollmentsApi.sonder(entree()),
    onSuccess: (d) => {
      setSondage(d);
      setErreur(null);
    },
    onError: (e: unknown) =>
      setErreur(e instanceof ApiError ? e.message : "Le routeur n'a pas pu être interrogé."),
  });

  const raccorder = useMutation({
    mutationFn: () => enrollmentsApi.raccorder(entree()),
    onSuccess: (d) => {
      setResultat(d);
      setErreur(null);
      // Le mot de passe administrateur n'a plus aucune raison de rester en
      // mémoire de ce navigateur : le serveur l'a déjà oublié.
      setForm((f) => ({ ...f, password: '' }));
      void queryClient.invalidateQueries({ queryKey: ['routers'] });
      void queryClient.invalidateQueries({ queryKey: ['mise-en-route'] });
    },
    onError: (e: unknown) =>
      setErreur(e instanceof ApiError ? e.message : "Le raccordement n'a pas abouti."),
  });

  const enCours = sonder.isPending || raccorder.isPending;

  if (resultat) {
    return (
      <Modale
        titre="Routeur raccordé"
        onFermer={() => {
          onFini();
          onFermer();
        }}
        actions={
          <Button
            onClick={() => {
              onFini();
              onFermer();
            }}
          >
            Terminer
          </Button>
        }
      >
        <Pastille ok>
          <strong>
            {resultat.identite} est raccordé — RouterOS {resultat.version}.
          </strong>
        </Pastille>
        <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
          {resultat.etapes.map((e) => (
            <li key={e} className="flex gap-2">
              <span aria-hidden className="text-emerald-600">
                ✓
              </span>
              <span>{e}</span>
            </li>
          ))}
        </ul>
        {/* Ce qui n'a pas encore eu lieu compte autant : un tunnel posé n'est
            pas un tunnel éprouvé, et laisser croire le contraire ferait
            chercher la panne ailleurs le jour où il ne monte pas. */}
        <p className="mt-3 text-sm text-slate-600">
          La console continue de joindre ce routeur par son adresse locale. Le tunnel{' '}
          <code className="rounded bg-slate-100 px-1">{resultat.tunnelAddress}</code> est posé mais
          pas encore éprouvé : il prendra le relais une fois sa première poignée de main constatée.
        </p>
      </Modale>
    );
  }

  const soumettre = (e: FormEvent) => {
    e.preventDefault();
    if (!sondage?.joignable || !sondage.versionSuffisante) sonder.mutate();
    else raccorder.mutate();
  };

  return (
    <Modale
      titre="Raccorder automatiquement"
      onFermer={onFermer}
      note={
        <>
          Votre mot de passe Winbox <strong>n&apos;est pas enregistré</strong>. Il sert une fois, le
          temps que la console pose le tunnel et crée un compte dédié aux droits limités — c&apos;est
          ce compte-là, et lui seul, qui restera. Votre compte administrateur n&apos;est pas modifié.
        </>
      }
      actions={
        <Button onClick={soumettre} disabled={enCours || !form.password}>
          {sonder.isPending
            ? 'Vérification…'
            : raccorder.isPending
              ? 'Raccordement…'
              : sondage?.joignable && sondage.versionSuffisante
                ? 'Raccorder ce routeur'
                : 'Vérifier le routeur'}
        </Button>
      }
    >
      <form onSubmit={soumettre} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <FormField label="Adresse du routeur">
              <Input
                required
                value={form.host}
                onChange={(e) => {
                  setForm({ ...form, host: e.target.value });
                  setSondage(null);
                }}
                placeholder={HOTE_PAR_DEFAUT}
              />
            </FormField>
          </div>
          <FormField label="Port sécurisé">
            <Input
              value={form.port}
              onChange={(e) => {
                setForm({ ...form, port: e.target.value });
                setSondage(null);
              }}
              placeholder="443"
            />
          </FormField>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Identifiant Winbox">
            <Input
              required
              value={form.username}
              onChange={(e) => {
                setForm({ ...form, username: e.target.value });
                setSondage(null);
              }}
              placeholder="admin"
            />
          </FormField>
          <FormField label="Mot de passe Winbox">
            <Input
              required
              type="password"
              value={form.password}
              onChange={(e) => {
                setForm({ ...form, password: e.target.value });
                setSondage(null);
              }}
            />
          </FormField>
        </div>

        <FormField label="Nom dans la console (facultatif)">
          <Input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder={sondage?.identite ?? 'le nom du routeur sera repris'}
          />
        </FormField>
      </form>

      {erreur && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {erreur}
        </div>
      )}

      {sondage && (
        <div className="mt-3 space-y-3">
          <Pastille ok={sondage.joignable && sondage.versionSuffisante}>
            {sondage.message}
            {sondage.joignable && sondage.modele && (
              <p className="mt-1 text-xs">
                Modèle {sondage.modele}
                {sondage.empreinte && ' · certificat relevé, il sera épinglé'}
              </p>
            )}
          </Pastille>

          {/* Le tunnel ne montera jamais si le serveur annonce au routeur une
              adresse qu'il n'a plus. Le dire ici, avant d'écrire quoi que ce
              soit, évite un diagnostic qui a déjà coûté une journée. */}
          {sondage.adressePerimee && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              <strong>L&apos;adresse du serveur n&apos;est plus la bonne.</strong> Le routeur se
              verra annoncer{' '}
              <code className="rounded bg-red-100 px-1">{sondage.adressePerimee.configuree}</code>,
              que cette machine ne porte plus
              {sondage.adressePerimee.actuelle && (
                <>
                  {' '}
                  — elle répond sur{' '}
                  <code className="rounded bg-red-100 px-1">{sondage.adressePerimee.actuelle}</code>
                </>
              )}
              . Corrigez <code>WIREGUARD_ENDPOINT_HOST</code> et <code>PUBLIC_BASE_URL</code> dans
              le <code>.env</code> du serveur, redémarrez-le, puis recommencez. Le routeur sera
              raccordé, mais son tunnel ne montera pas.
            </div>
          )}
        </div>
      )}
    </Modale>
  );
}
