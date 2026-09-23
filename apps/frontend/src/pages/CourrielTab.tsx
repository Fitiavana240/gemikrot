import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, FormField, Input, Table } from '../components/ui';

/**
 * Le serveur d'envoi de l'exploitant, et la trace de ce qui est parti.
 *
 * **Un SMTP par exploitant** : le message part de son adresse, à sa marque.
 * Un compte unique de plateforme ferait écrire à ses clients depuis une
 * adresse qui n'est pas la sienne.
 *
 * **Rien ne part tant qu'il n'a pas coché.** Enregistrer une configuration ne
 * doit pas suffire à déclencher des messages : c'est un interrupteur, pas une
 * conséquence.
 */

interface Reglages {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  actif: boolean;
  motDePassePose: boolean;
  /** Plateforme seulement : le nom qui signe, et ou l'on paie. */
  nom?: string;
  contactTelephone?: string;
  contactWhatsapp?: string;
  contactCourriel?: string;
}

/**
 * Deux serveurs d'envoi, un seul ecran.
 *
 * L'exploitant ecrit a ses clients depuis sa propre adresse, a sa marque. La
 * plateforme ecrit aux exploitants : codes de confirmation, avis
 * d'inscription, confirmations d'abonnement. Ce sont deux reglages distincts
 * et la difference compte — mais les recopier ferait deux ecrans qui
 * divergeraient au premier changement. Le meme, parametre par sa portee.
 */
type Portee = 'exploitant' | 'plateforme';

const CHEMINS: Record<Portee, { reglages: string; journal: string; essai: string }> = {
  exploitant: { reglages: '/courriel', journal: '/courriel/journal', essai: '/courriel/essai' },
  plateforme: {
    reglages: '/courriel/plateforme',
    journal: '/courriel/plateforme/journal',
    essai: '/courriel/plateforme/essai',
  },
};

interface Courriel {
  id: string;
  destinataire: string;
  sujet: string;
  type: string;
  statut: string;
  erreur: string | null;
  createdAt: string;
}

export function CourrielTab({ portee = 'exploitant' }: { portee?: Portee } = {}) {
  const { canWrite, user } = useAuth();
  const chemins = CHEMINS[portee];
  const plateforme = portee === 'plateforme';
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Reglages | null>(null);
  const [motDePasse, setMotDePasse] = useState('');
  const [destinataire, setDestinataire] = useState(user?.email ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [compteRendu, setCompteRendu] = useState<string | null>(null);

  const reglages = useQuery({
    queryKey: ['courriel', portee],
    queryFn: () => api.get<Reglages>(chemins.reglages),
    retry: false,
  });
  const journal = useQuery({
    queryKey: ['courriel-journal', portee],
    queryFn: () => api.get<Courriel[]>(chemins.journal),
    retry: false,
  });

  // Une fois : recopier à chaque rendu écraserait la saisie en cours.
  useEffect(() => {
    if (reglages.data && form === null) setForm(reglages.data);
  }, [reglages.data, form]);

  const enregistrer = useMutation({
    mutationFn: () =>
      api.patch<Reglages>(chemins.reglages, {
        ...form,
        // Envoyé seulement s'il a été saisi : le champ revient toujours vide,
        // et le transmettre tel quel effacerait le mot de passe enregistré.
        ...(motDePasse ? { motDePasse } : {}),
      }),
    onSuccess: (r) => {
      setErreur(null);
      setForm(r);
      setMotDePasse('');
      setCompteRendu('Réglages enregistrés.');
      queryClient.invalidateQueries({ queryKey: ['courriel', portee] });
    },
    onError: (e) => setErreur(e instanceof ApiError ? e.message : 'Erreur inconnue'),
  });

  const essai = useMutation({
    mutationFn: () =>
      api.post<{ envoye: boolean; erreur?: string }>(chemins.essai, { destinataire }),
    onSuccess: (r) => {
      setErreur(r.envoye ? null : (r.erreur ?? 'Envoi refusé.'));
      setCompteRendu(r.envoye ? `Message envoyé à ${destinataire}. Vérifiez la boîte.` : null);
      queryClient.invalidateQueries({ queryKey: ['courriel-journal', portee] });
    },
    onError: (e) => setErreur(e instanceof ApiError ? e.message : "L'envoi a échoué."),
  });

  const champ = (clef: keyof Reglages, valeur: string | number | boolean) =>
    setForm((f) => (f ? { ...f, [clef]: valeur } : f));

  return (
    <div className="space-y-4">
      {compteRendu && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {compteRendu}
        </p>
      )}
      {erreur && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {erreur}
        </p>
      )}

      {plateforme && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Ce serveur est celui de la <strong>plateforme</strong>, pas celui d’un exploitant.
          C’est lui qui porte les <strong>codes de confirmation</strong>, les avis d’inscription
          et les confirmations d’abonnement. Tant qu’il n’est pas réglé, un nouvel inscrit ne
          peut pas valider son adresse — et personne ne peut plus le prévenir de rien.
        </p>
      )}

      <Card title="Serveur d’envoi">
        {form === null ? (
          <div className="h-48 animate-pulse rounded bg-slate-100" />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Serveur SMTP" aide="Par exemple smtp.gmail.com">
                <Input value={form.host} onChange={(e) => champ('host', e.target.value)} />
              </FormField>
              <FormField label="Port" aide="587 pour STARTTLS, 465 pour TLS direct.">
                <Input
                  type="number"
                  value={String(form.port)}
                  onChange={(e) => champ('port', Number(e.target.value) || 587)}
                />
              </FormField>
              <FormField
                label="Chiffrement"
                aide="Cochez pour le port 465 : le lien est chiffré dès la connexion."
              >
                <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.secure}
                    onChange={(e) => champ('secure', e.target.checked)}
                  />
                  TLS direct (465)
                </label>
              </FormField>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Identifiant">
                <Input value={form.user} onChange={(e) => champ('user', e.target.value)} />
              </FormField>
              <FormField
                label="Mot de passe"
                aide={
                  form.motDePassePose
                    ? 'Un mot de passe est enregistré. Laissez vide pour le garder.'
                    : "Il est chiffré avant d'être stocké et ne revient jamais à cet écran."
                }
              >
                <Input
                  type="password"
                  value={motDePasse}
                  placeholder={form.motDePassePose ? '••••••••' : ''}
                  onChange={(e) => setMotDePasse(e.target.value)}
                />
              </FormField>
            </div>

            <FormField
              label="Expéditeur"
              aide="Ce que voit le destinataire. Exemple : Zone WIFI-TATI <contact@wifitati.net>"
            >
              <Input value={form.from} onChange={(e) => champ('from', e.target.value)} />
            </FormField>

            {/* L'interrupteur, séparé du reste : régler n'est pas allumer. */}
            <label className="flex items-start gap-2 pt-1 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.actif}
                onChange={(e) => champ('actif', e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Autoriser l’envoi de courriels
                <span className="mt-0.5 block text-xs text-slate-500">
                  Tant que la case est décochée, <strong>rien ne part</strong> — même réglé.
                  Chaque tentative reste inscrite au journal ci-dessous, avec la raison.
                </span>
              </span>
            </label>

            {canWrite && (
              <div className="flex flex-wrap items-end gap-3 pt-1">
                <Button disabled={enregistrer.isPending} onClick={() => enregistrer.mutate()}>
                  {enregistrer.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
                <FormField label="Envoyer un essai à">
                  <Input
                    value={destinataire}
                    onChange={(e) => setDestinataire(e.target.value)}
                    className="w-64"
                  />
                </FormField>
                <Button
                  variant="secondary"
                  disabled={essai.isPending || !destinataire.trim()}
                  onClick={() => essai.mutate()}
                >
                  {essai.isPending ? 'Envoi…' : 'Envoyer un essai'}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Ou l'exploitant s'adresse pour payer. Vide, la page de blocage le dit
          franchement plutot que d'afficher un numero mort a quelqu'un qui
          cherche justement a regler sa facture. */}
      {plateforme && form !== null && (
        <Card title="Où les exploitants vous joignent">
          <p className="mb-3 text-sm text-slate-600">
            Affiché sur la page de blocage d’un exploitant dont l’abonnement a expiré. Tout vide,
            la page dit qu’aucun moyen de contact n’est configuré.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Téléphone">
              <Input
                value={form.contactTelephone ?? ''}
                onChange={(e) => champ('contactTelephone', e.target.value)}
              />
            </FormField>
            <FormField label="WhatsApp" aide="Chiffres seuls, ex. 261340000000">
              <Input
                value={form.contactWhatsapp ?? ''}
                onChange={(e) => champ('contactWhatsapp', e.target.value)}
              />
            </FormField>
            <FormField label="Courriel">
              <Input
                value={form.contactCourriel ?? ''}
                onChange={(e) => champ('contactCourriel', e.target.value)}
              />
            </FormField>
          </div>
        </Card>
      )}

      {/* Le journal compte autant que le réglage : sans lui, un envoi raté
          laisse l'exploitant croire qu'il a prévenu. */}
      <Card title="Ce qui est parti">
        <Table head={['Quand', 'À', 'Objet', 'Motif', 'État']}>
          {journal.data?.map((c) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                {new Date(c.createdAt).toLocaleString('fr-FR')}
              </td>
              <td className="px-3 py-2">{c.destinataire}</td>
              <td className="px-3 py-2 text-slate-600">{c.sujet}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-500">{c.type}</td>
              <td className="px-3 py-2">
                {c.statut === 'ENVOYE' ? (
                  <Badge tone="green">envoyé</Badge>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <Badge tone="red">échec</Badge>
                    <span className="text-xs text-red-700">{c.erreur}</span>
                  </span>
                )}
              </td>
            </tr>
          ))}
          {journal.data?.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                Aucun envoi pour l’instant.
              </td>
            </tr>
          )}
        </Table>
      </Card>

      <p className="max-w-3xl text-xs text-slate-500">
        Le mot de passe est chiffré avec la même clef que vos identifiants routeur
        (<span className="font-mono">ROUTER_CREDENTIALS_KEY</span>) : sauvegardez-la séparément
        de la base, sans quoi les deux deviennent illisibles.
        <br />
        Un courriel qui ne part pas <strong>n’interrompt jamais</strong> ce qui l’a déclenché :
        un paiement se déclare et se vérifie même si l’avertissement échoue. L’échec se lit
        ici, pas dans une panne.
      </p>
    </div>
  );
}
