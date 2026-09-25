import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hotspotApi, type ReglagesPageConnexion } from '../api/hotspot';
import { useAuth } from '../auth/AuthContext';
import { useRouterSelection } from '../routers/RouterContext';
import { ApiError } from '../api/client';
import { Confirmation } from '../components/Edition';
import { Button, Card, FormField, Input } from '../components/ui';
import { LogoPortail } from '../components/LogoPortail';

/**
 * La page que voit un client connecté au Wi-Fi mais pas encore à Internet.
 *
 * C'est le maillon qui manquait au parcours d'achat. Le Walled Garden
 * laissait déjà passer la page de paiement — l'entrée existe, avec le bon
 * port — mais elle était comptée à **zéro visite**, faute de lien : un client
 * sans code voyait une page qui ne lui proposait rien, et devait trouver le
 * vendeur.
 *
 * **Le bouton d'achat n'est pas dans ce que l'exploitant règle.** Il en change
 * les mots ; le bloc, lui, est écrit par le serveur. On ne supprime pas ce
 * qu'on ne tient pas. Le formulaire de connexion non plus : une page de
 * connexion cassée, et plus personne ne se connecte — clients payants
 * compris.
 */

/** Ce que le client tape : l'adresse doit lui être joignable sans Internet. */
const EXEMPLE_PORTAIL = 'http://192.168.88.135:5173';

export function PageConnexionTab() {
  const { canWrite } = useAuth();
  const { currentId } = useRouterSelection();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ReglagesPageConnexion | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  const [autorisation, setAutorisation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [compteRendu, setCompteRendu] = useState<string | null>(null);

  /**
   * L'adresse saisie, mais pas à chaque frappe.
   *
   * Vérifier les empêchements demande trois lectures du routeur — serveurs,
   * profils, fichiers. Les lancer à chaque caractère d'une adresse ferait
   * partir des dizaines d'allers-retours sur un lien qui met 150 ms à
   * répondre, et la réponse affichée serait celle d'une frappe précédente.
   */
  const [portailDiffere, setPortailDiffere] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setPortailDiffere(form?.portailUrl ?? ''), 500);
    return () => clearTimeout(t);
  }, [form?.portailUrl]);

  const etat = useQuery({
    // L'adresse entre dans la clef : les refus suivent ce qu'on tape, au lieu
    // de n'apparaître qu'après avoir enregistré.
    queryKey: ['page-connexion-etat', currentId, portailDiffere],
    queryFn: () => hotspotApi.etatPageConnexion(currentId, portailDiffere),
    retry: false,
  });

  /**
   * Le formulaire part des réglages enregistrés, une fois.
   *
   * Le recopier à chaque rendu écraserait la saisie en cours dès que la
   * requête se rafraîchit — on tape un titre, il redevient l'ancien.
   */
  useEffect(() => {
    if (etat.data && form === null) setForm(etat.data.reglages);
  }, [etat.data, form]);

  /**
   * L'aperçu suit la saisie, avec le même délai.
   *
   * Il ne touche pas au routeur — c'est un rendu de texte — mais une requête
   * par caractère fait clignoter l'iframe à chaque lettre, ce qui rend le
   * réglage désagréable au moment même où on le relit.
   */
  const [formDiffere, setFormDiffere] = useState<ReglagesPageConnexion | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setFormDiffere(form), 350);
    return () => clearTimeout(t);
  }, [form]);

  const apercu = useQuery({
    queryKey: ['page-connexion-apercu', formDiffere],
    queryFn: () => hotspotApi.apercuPageConnexion(formDiffere ?? {}),
    enabled: formDiffere !== null,
    retry: false,
  });

  const enregistrer = useMutation({
    mutationFn: () => hotspotApi.enregistrerPageConnexion(form ?? {}),
    onSuccess: (r) => {
      setErreur(null);
      setForm(r.reglages);
      setCompteRendu('Réglages enregistrés. Rien n’a encore été envoyé au routeur.');
      queryClient.invalidateQueries({ queryKey: ['page-connexion-etat'] });
    },
    onError: (e) => setErreur(e instanceof ApiError ? e.message : 'Erreur inconnue'),
  });

  const telecharger = useMutation({
    mutationFn: () => hotspotApi.telechargerPageConnexion(form ?? {}),
    onSuccess: () => {
      setErreur(null);
      setCompteRendu(
        'Fichier téléchargé. Il est prêt à être posé dans le routeur — la marche à suivre est en bas de cet écran.',
      );
    },
    onError: (e) =>
      setErreur(e instanceof ApiError ? e.message : 'Le téléchargement a échoué.'),
  });

  /**
   * Ouvre l'adresse de paiement dans le Walled Garden.
   *
   * Sans elle, un client non connecte qui presse le bouton d'achat ne voit
   * pas une page vide : RouterOS **rejette** sa connexion avec un TCP reset --
   * la chaine `hs-unauth` est ainsi faite -- et le navigateur affiche
   * << ERR_CONNECTION_REFUSED >>. Rien dans ce message ne mene au Walled
   * Garden ; on cherche du cote du serveur, qui n'y est pour rien.
   *
   * C'est une **ecriture sur le routeur**, et elle ouvre un passage vers une
   * machine pour tous les clients non authentifies : elle se demande, elle ne
   * se fait pas toute seule.
   */
  const autoriser = useMutation({
    mutationFn: () => {
      const u = new URL(
        (form?.portailUrl ?? '').includes('://')
          ? (form?.portailUrl ?? '')
          : `http://${form?.portailUrl ?? ''}`,
      );
      return hotspotApi.addIp(
        {
          dstAddress: u.hostname,
          // Le port est repris de l'adresse : ouvrir tous les ports d'une
          // machine pour servir une page serait ouvrir bien plus large que
          // necessaire.
          dstPort: u.port || undefined,
          comment: 'Page de paiement GeMikrot',
        },
        currentId,
      );
    },
    onSuccess: () => {
      setErreur(null);
      setAutorisation(false);
      setCompteRendu('Adresse autorisée dans le Walled Garden. Le bouton d’achat peut désormais aboutir.');
      queryClient.invalidateQueries({ queryKey: ['page-connexion-etat'] });
      queryClient.invalidateQueries({ queryKey: ['walled-garden'] });
    },
    onError: (e) => setErreur(e instanceof ApiError ? e.message : 'Le routeur a refusé.'),
  });

  const publier = useMutation({
    mutationFn: () => hotspotApi.publierPageConnexion(currentId),
    onSuccess: (r) => {
      setErreur(null);
      setConfirmer(false);
      setCompteRendu(
        `Page écrite sur le routeur : ${r.ecrits.map((e) => e.chemin).join(', ')} — ${
          r.ecrits[0]?.octets ?? 0
        } octets.`,
      );
      queryClient.invalidateQueries({ queryKey: ['page-connexion-etat'] });
    },
    onError: (e) => setErreur(e instanceof ApiError ? e.message : 'Le routeur a refusé.'),
  });

  const champ = (clef: keyof ReglagesPageConnexion, valeur: string) =>
    setForm((f) => (f ? { ...f, [clef]: valeur } : f));

  const d = etat.data;
  const bloque = (d?.empechements.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      {compteRendu && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {compteRendu}
        </p>
      )}
      {erreur && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {erreur}
        </p>
      )}

      {/* Avant les champs : ce qui empêchera de publier. Les découvrir au
          moment de cliquer, après avoir tout réglé, ferait recommencer. */}
      {d?.empechements.map((m) => (
        <p
          key={m}
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <strong>Publication impossible.</strong> {m}
        </p>
      ))}
      {d?.avertissements.map((m) => (
        <div
          key={m}
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {m}
          {/* Un avertissement qu'on ne peut pas lever depuis l'ecran ou il
              s'affiche envoie chercher ailleurs. Celui-la se leve ici. */}
          {canWrite && m.includes('Walled Garden') && !m.includes('logo') && (
            <div className="mt-2">
              <Button variant="secondary" onClick={() => setAutorisation(true)}>
                Autoriser cette adresse
              </Button>
            </div>
          )}
        </div>
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Ce que voit votre client">
          {form === null ? (
            <div className="h-64 animate-pulse rounded bg-slate-100" />
          ) : (
            <div className="space-y-3">
              <FormField label="Titre">
                <Input value={form.titre} onChange={(e) => champ('titre', e.target.value)} />
              </FormField>
              <FormField label="Phrase sous le titre">
                <Input
                  value={form.sousTitre}
                  onChange={(e) => champ('sousTitre', e.target.value)}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Bouton de connexion">
                  <Input
                    value={form.libelleConnexion}
                    onChange={(e) => champ('libelleConnexion', e.target.value)}
                  />
                </FormField>
                {/* Le texte se règle, le bouton non : c'est ce qui le rend
                    indélébile. L'aide sous le champ le dit, plutôt que de
                    laisser croire qu'on pourrait l'enlever. */}
                <FormField
                  label="Bouton d'achat"
                  aide="Ce bouton est toujours présent : seul son texte se règle."
                >
                  <Input
                    value={form.libelleAchat}
                    onChange={(e) => champ('libelleAchat', e.target.value)}
                  />
                </FormField>
              </div>
              <FormField label="Phrase sous le bouton d'achat">
                <Input
                  value={form.aideAchat}
                  onChange={(e) => champ('aideAchat', e.target.value)}
                />
              </FormField>
              {/* Le pied de page de la vraie page de ce parc portait
                  l'adresse du local, deux numéros et la page Facebook. Une
                  seule ligne ne pouvait pas les tenir, et les perdre serait un
                  recul : c'est par là que les clients appellent. */}
              <FormField label="Pied de page (première ligne)">
                <Input
                  value={form.piedDePage}
                  onChange={(e) => champ('piedDePage', e.target.value)}
                />
              </FormField>
              <FormField
                label="Adresse du local"
                aide="Comme on l'explique à quelqu'un du quartier."
              >
                <Input
                  value={form.adresse}
                  placeholder="Motombe-Tanambao, ambadik'i Garage Belia Rasta"
                  onChange={(e) => champ('adresse', e.target.value)}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Téléphones">
                  <Input
                    value={form.telephones}
                    placeholder="034 72 818 91 - 033 12 835 90"
                    onChange={(e) => champ('telephones', e.target.value)}
                  />
                </FormField>
                <FormField
                  label="Page Facebook"
                  aide="En toutes lettres : un client captif n'a pas Internet, un lien ne mènerait nulle part."
                >
                  <Input
                    value={form.reseauSocial}
                    placeholder="Zone Wifi-TATI"
                    onChange={(e) => champ('reseauSocial', e.target.value)}
                  />
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  label="Couleur d'accent"
                  aide="Elle porte du texte blanc : une teinte trop claire est refusée."
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(form.couleur) ? form.couleur : '#0284c7'}
                      onChange={(e) => champ('couleur', e.target.value)}
                      className="h-9 w-12 cursor-pointer rounded border border-slate-300"
                      aria-label="Couleur d'accent"
                    />
                    <Input
                      value={form.couleur}
                      onChange={(e) => champ('couleur', e.target.value)}
                      className="font-mono"
                    />
                  </div>
                </FormField>
              </div>
              <FormField label="Logo">
                <LogoPortail
                  valeur={form.logoUrl}
                  onChange={(v) => champ('logoUrl', v)}
                />
              </FormField>
              {/* Elle se tapait à la main, et rien ne disait laquelle prendre.
                  Elle se déduit pourtant : la console connaît ses cartes
                  réseau, le routeur annonce l'adresse de son portail, et on
                  garde celles qui sont sur le même réseau. Les cartes
                  virtuelles d'un poste de travail tombent d'elles-mêmes —
                  elles sont injoignables depuis le Wi-Fi. */}
              <FormField
                label="Adresse de la page de paiement"
                aide="C'est elle que le bouton d'achat ouvrira. Elle doit être joignable depuis le Wi-Fi seul, sans Internet — donc jamais le nom du portail captif lui-même."
              >
                <Input
                  value={form.portailUrl}
                  placeholder={EXEMPLE_PORTAIL}
                  onChange={(e) => champ('portailUrl', e.target.value)}
                />
              </FormField>
              {(d?.adresses.length ?? 0) > 0 && (
                <div className="-mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500">Détectées&nbsp;:</span>
                  {d?.adresses.map((a) => (
                    <button
                      key={a.url}
                      type="button"
                      onClick={() => champ('portailUrl', a.url)}
                      className={`rounded-full border px-2.5 py-1 font-mono ${
                        form.portailUrl === a.url
                          ? 'border-sky-300 bg-sky-50 text-sky-800'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                      title={
                        a.source === 'console-publique'
                          ? 'Adresse publique de cette console — la seule qui marche depuis n’importe où'
                          : a.source === 'domaine'
                            ? 'Votre domaine — il doit pointer vers cette console'
                            : 'Adresse de cette machine sur le réseau du portail'
                      }
                    >
                      {a.url}
                      {/* Autorisée ou non : c'est ce qui décide si le bouton
                          mènera quelque part, et c'est lu sur le routeur. */}
                      <span className={a.autorisee ? 'text-emerald-700' : 'text-amber-700'}>
                        {a.autorisee ? ' ✓' : ' ⚠'}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Calculé, jamais saisi : l'affiche écrite à la main de ce parc
                  annonçait « 1 Ora » pour 500 Ar quand le routeur en donne
                  deux, une offre à 30 000 Ar qui n'existe pas, et taisait les
                  4 h à 1 000 Ar. Ce tableau-là ne peut plus diverger. */}
              <label className="flex items-start gap-2 pt-1 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.afficherTarifs}
                  onChange={(e) =>
                    setForm((f) => (f ? { ...f, afficherTarifs: e.target.checked } : f))
                  }
                  className="mt-0.5"
                />
                <span>
                  Afficher le tableau des tarifs
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Calculé depuis vos offres actives à ticket — les mêmes que voit la page
                    de paiement. Il ne peut donc pas annoncer un prix ou une durée que vous ne
                    vendez pas.
                  </span>
                </span>
              </label>

              {form.afficherTarifs && (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <FormField label="Titre du tableau">
                    <Input
                      value={form.titreTarifs}
                      placeholder="SARANY (Tarifs)"
                      onChange={(e) => champ('titreTarifs', e.target.value)}
                    />
                  </FormField>
                  {/* Chaque exploitant a ses offres, et n'a pas forcément envie
                      de toutes les afficher : dix lignes sur un téléphone
                      noient celle qu'on cherche. Décocher retire de
                      l'affiche, jamais de la vente — l'offre reste achetable
                      sur la page de paiement. */}
                  <div className="space-y-1">
                    {(d?.tarifs ?? []).map((t) => (
                      <label
                        key={t.id}
                        className="flex items-center gap-2 text-sm text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={!form.tarifsMasques.includes(t.id)}
                          onChange={(e) =>
                            setForm((f) =>
                              f
                                ? {
                                    ...f,
                                    tarifsMasques: e.target.checked
                                      ? f.tarifsMasques.filter((x) => x !== t.id)
                                      : [...f.tarifsMasques, t.id],
                                  }
                                : f,
                            )
                          }
                        />
                        <span className="tabular-nums font-medium">{t.prix}</span>
                        <span className="text-slate-500">
                          {t.duree}
                          {t.appareils && t.appareils > 1 ? ` (${t.appareils} appareils)` : ''}
                        </span>
                        <span className="truncate text-xs text-slate-400">{t.nom}</span>
                      </label>
                    ))}
                    {(d?.tarifs.length ?? 0) === 0 && (
                      <p className="text-xs text-slate-500">
                        Aucune offre à ticket active : le tableau ne s&apos;affichera pas.
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Décocher retire la ligne de l&apos;affiche, <strong>pas de la vente</strong> :
                    l&apos;offre reste achetable sur la page de paiement.
                  </p>
                </div>
              )}

              {canWrite && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    disabled={enregistrer.isPending}
                    onClick={() => enregistrer.mutate()}
                  >
                    {enregistrer.isPending ? 'Enregistrement…' : 'Enregistrer'}
                  </Button>
                  {/* Le second chemin, et le seul qui marche quand la
                      console n'atteint pas le routeur. Il ne dépend d'aucun
                      empêchement côté routeur : on télécharge même sans lui. */}
                  <Button
                    variant="secondary"
                    disabled={telecharger.isPending || apercu.isError}
                    onClick={() => telecharger.mutate()}
                  >
                    {telecharger.isPending ? 'Préparation…' : 'Télécharger le fichier'}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={bloque || apercu.isError || publier.isPending}
                    onClick={() => setConfirmer(true)}
                  >
                    Publier sur le routeur
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Aperçu — ce qui sera écrit">
          {apercu.isPending ? (
            <div className="h-96 animate-pulse rounded bg-slate-100" />
          ) : apercu.isError ? (
            <p className="text-sm text-red-700">
              {apercu.error instanceof ApiError
                ? apercu.error.message
                : "L'aperçu n'a pas pu être produit."}
            </p>
          ) : (
            <>
              <div className="mb-2 text-xs text-slate-500">{apercu.data?.octets} octets</div>
              {/* Le rendu, pas le code : c'est ce que le client verra, et c'est
                  la seule chose qu'on puisse vraiment relire. `sandbox` sans
                  `allow-scripts` : la page porte du JavaScript, et rien ne
                  justifie de l'exécuter dans la console. */}
              <iframe
                title="Aperçu de la page de connexion"
                sandbox=""
                srcDoc={apercu.data?.contenu ?? ''}
                className="h-[28rem] w-full rounded-lg border border-slate-200 bg-white"
              />
            </>
          )}
        </Card>
      </div>

      {/* Où la page ira réellement. Le chemin était en dur : il se trouve juste
          ici, et faux dès qu'un serveur utilise le profil `default`. */}
      {d && d.cibles.length > 0 && (
        <Card title="Où la page sera écrite">
          <ul className="space-y-2 text-sm">
            {d.cibles.map((c) => (
              <li key={c.chemin} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs text-slate-700">{c.chemin}</span>
                <span className="text-slate-500">
                  sert {c.serveurs.join(', ')}
                </span>
                {c.publie ? (
                  <span className="text-slate-500">
                    · publiée le {new Date(c.publie.publieLe).toLocaleString('fr-FR')} (
                    {c.publie.octets} octets)
                  </span>
                ) : (
                  <span className="text-amber-800">· jamais publiée par la console</span>
                )}
                {c.surLeRouteur && (
                  <span className="text-slate-500">
                    · sur le routeur : {c.surLeRouteur.octets} octets,{' '}
                    {c.surLeRouteur.modifieLe}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {autorisation && (
        <Confirmation
          titre="Autoriser cette adresse dans le Walled Garden ?"
          libelléConfirmer="Oui, autoriser"
          enCours={autoriser.isPending}
          erreur={autoriser.isError ? erreur : null}
          onAnnuler={() => {
            setErreur(null);
            setAutorisation(false);
          }}
          onConfirmer={() => autoriser.mutate()}
        >
          <p>
            Une règle est ajoutée sur le routeur pour laisser passer{' '}
            <span className="font-mono text-xs">{form?.portailUrl}</span>{' '}
            <strong>avant toute connexion</strong>. C&apos;est ce qui manque aujourd&apos;hui :
            RouterOS rejette la connexion d&apos;un client non authentifié, et son navigateur
            affiche « ERR_CONNECTION_REFUSED » — un message qui ne parle jamais du Walled
            Garden.
          </p>
          <p className="mt-2">
            Elle ouvre ce port <strong>sur cette machine uniquement</strong>, pour tous les
            appareils connectés au Wi-Fi, même sans code. Elle se retire dans
            l&apos;onglet <em>Walled Garden</em>.
          </p>
        </Confirmation>
      )}

      {confirmer && (
        <Confirmation
          titre="Voulez-vous vraiment remplacer la page de connexion du routeur ?"
          libelléConfirmer="Oui, remplacer"
          enCours={publier.isPending}
          erreur={publier.isError ? erreur : null}
          onAnnuler={() => {
            setErreur(null);
            setConfirmer(false);
          }}
          onConfirmer={() => publier.mutate()}
        >
          <p>
            L&apos;ancienne page est écrasée et <strong>RouterOS n&apos;en garde aucune
            copie</strong>. Si la nouvelle est fautive, plus personne ne peut se connecter —
            ni les clients déjà payants, ni ceux qui viennent d&apos;acheter.
          </p>
          <p className="mt-2">
            Elle sera écrite dans{' '}
            <span className="font-mono text-xs">
              {d?.cibles.map((c) => c.chemin).join(', ')}
            </span>{' '}
            — les dossiers que servent réellement vos serveurs HotSpot.
          </p>
          <p className="mt-2">
            Relisez l&apos;aperçu, et surtout l&apos;adresse{' '}
            <span className="font-mono text-xs">{form?.portailUrl}</span> : c&apos;est elle
            que le bouton d&apos;achat ouvrira, et elle doit être joignable{' '}
            <strong>depuis le Wi-Fi seul</strong>, sans Internet.
          </p>
        </Confirmation>
      )}

      {/* Nommé, pas générique : la console connaît le dossier de CE routeur.
          Un tutoriel qui dit « déposez dans hotspot/ » ferait installer la
          page là où personne ne la sert — le défaut qu'on vient de corriger,
          reproduit par la documentation. */}
      <Card title="L’installer soi-même, sans passer par la console">
        <ol className="max-w-3xl list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>
            <strong>Télécharger le fichier</strong> avec le bouton ci-dessus. Il s’appelle{' '}
            <span className="font-mono text-xs">login.html</span> et contient déjà vos
            réglages : rien n’est à modifier dedans.
          </li>
          <li>
            Ouvrir <strong>WinBox</strong> (ou WebFig) sur le routeur, puis le menu{' '}
            <strong>Files</strong>.
          </li>
          <li>
            Entrer dans le dossier{' '}
            <span className="font-mono text-xs">
              {d?.cibles[0]?.chemin.replace(/\/login\.html$/, '') ?? 'hotspot'}
            </span>
            {d && d.cibles.length > 1 && (
              <>
                {' '}
                — et refaire l’opération dans{' '}
                <span className="font-mono text-xs">
                  {d.cibles
                    .slice(1)
                    .map((c) => c.chemin.replace(/\/login\.html$/, ''))
                    .join(', ')}
                </span>
              </>
            )}
            . {d?.cibles[0] && (
              <span className="text-slate-500">
                C’est le dossier que sert {d.cibles[0].serveurs.join(', ')} sur{' '}
                <em>ce</em> routeur — pas forcément celui d’un autre.
              </span>
            )}
          </li>
          <li>
            <strong>Glisser le fichier</strong> dedans. WinBox demande de remplacer :
            accepter. L’ancien <span className="font-mono text-xs">login.html</span> est
            perdu, RouterOS n’en garde pas de copie.
          </li>
          <li>
            Se connecter au Wi-Fi avec un téléphone <strong>qui n’a pas encore de code</strong>{' '}
            et vérifier que la nouvelle page s’affiche, puis que le bouton d’achat ouvre bien
            la page de paiement.
          </li>
        </ol>
        <p className="mt-3 max-w-3xl text-xs text-slate-500">
          Ce chemin donne le même résultat que « Publier sur le routeur ». Il existe parce que
          la console ne peut pas toujours atteindre le routeur — c’est le cas tant qu’il n’y a
          ni tunnel ni adresse publique — et parce qu’il laisse voir le fichier avant de
          l’installer. En revanche, la console ne saura pas qu’il a été posé : elle ne compare
          la taille et la date qu’à ses propres publications.
        </p>
      </Card>

      <p className="max-w-3xl text-xs text-slate-500">
        Cette page est servie <strong>par le routeur</strong>, pas par la console : elle reste
        affichée même si l&apos;application est arrêtée. C&apos;est pourquoi elle ne va
        chercher aucune donnée — une page de connexion ne doit avoir aucun mode de panne.
        <br />
        Le formulaire de connexion et le bouton d&apos;achat ne font pas partie de ce que vous
        réglez : ils sont écrits par la console à chaque publication.{' '}
        <strong>Rien n&apos;empêche de les retirer depuis WinBox</strong> — c&apos;est votre
        routeur. Mais la console s&apos;en apercevra : elle compare la taille et la date du
        fichier servi à ceux de sa dernière publication. Elle ne peut pas en relire le
        contenu, RouterOS ne rendant un fichier que sous 4 096 octets.
      </p>
    </div>
  );
}
