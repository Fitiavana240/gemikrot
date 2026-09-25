import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { hotspotTabsApi, type DhcpLease, type HotspotHost, type IpBinding } from '../api/mikrotik-tabs';
import { devicesApi, type Device } from '../api/devices';
import { ApiError } from '../api/client';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Button, Card, Table, TableSkeleton } from '../components/ui';

/**
 * Ce qu'un `ip-binding` fait vraiment, et pourquoi il mérite son écran.
 *
 * `bypassed` fait passer un appareil **avant** le portail : pas de ticket, pas
 * de session, pas d'échéance. L'accès est inconditionnel et permanent jusqu'à
 * ce que quelqu'un retire la ligne à la main. Aucun compteur ne l'arrête, et
 * rien dans la console ne le facture.
 *
 * L'écran Appareils en montrait déjà, mais il parcourt les **baux DHCP** : un
 * appareil éteint n'a plus de bail (le bail dure une heure sur ce routeur) et
 * disparaît donc de la liste. On ne pouvait pas répondre à « qui a un accès
 * permanent » — seulement à « qui en a un et est allumé maintenant ».
 */
type Rapproché = {
  binding: IpBinding;
  appareil: Device | undefined;
};

/** `C0:8A:60:AB:61:75` de deux sources ne se compare qu'en majuscules. */
function clé(mac: string): string {
  return mac.trim().toUpperCase();
}

/**
 * Les appareils que le routeur voit, nommes quand il sait les nommer.
 *
 * Deux sources : les hotes du portail donnent la MAC telle que le routeur la
 * voit -- la seule qui vaille -- et les baux DHCP donnent le nom que
 * l'appareil s'est declare. Sans le nom, l'exploitant choisit entre douze
 * lignes hexadecimales identiques.
 */
function appareilsJoignables(
  hotes: HotspotHost[],
  baux: DhcpLease[],
): { mac: string; adresse: string | null; nom: string | null }[] {
  const nomParMac = new Map(baux.map((b) => [clé(b.macAddress), b.hostName]));
  const adresseParMac = new Map(baux.map((b) => [clé(b.macAddress), b.address]));
  const vus = new Map<string, { mac: string; adresse: string | null; nom: string | null }>();

  for (const h of hotes) {
    const k = clé(h.macAddress);
    if (!k) continue;
    vus.set(k, {
      mac: h.macAddress,
      // L'adresse du bail plutot que celle du portail : c'est celle que le
      // DHCP a reservee, donc celle qui tiendra.
      adresse: adresseParMac.get(k) ?? h.address,
      nom: nomParMac.get(k) ?? null,
    });
  }
  // Les baux seuls comptent aussi : un appareil peut avoir une adresse sans
  // avoir encore parle au portail.
  for (const b of baux) {
    const k = clé(b.macAddress);
    if (!k || vus.has(k)) continue;
    vus.set(k, { mac: b.macAddress, adresse: b.address, nom: b.hostName });
  }

  return [...vus.values()].sort((a, b) =>
    (a.nom ?? a.mac).localeCompare(b.nom ?? b.mac),
  );
}

/**
 * Mbit/s à l'écran, bits par seconde sur le fil.
 *
 * L'exploitant pense en mégabits ; RouterOS et la console comptent en bits.
 * Convertir ici, une fois, plutôt que de laisser deux unités circuler dans le
 * produit — elles finissent toujours par se croiser.
 */
function enBits(mbits: string): number | undefined {
  const n = Number(mbits.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1_000_000) : undefined;
}

export function AccesPermanentsTab() {
  const { currentId } = useRouterSelection();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    macAddress: '',
    address: '',
    comment: '',
    montant: '',
    descendant: '',
  });
  const [compteRendu, setCompteRendu] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['ip-bindings'] });
    queryClient.invalidateQueries({ queryKey: ['queues'] });
  };

  const creer = useMutation({
    mutationFn: () =>
      hotspotTabsApi.creerContournement(
        {
          macAddress: form.macAddress.trim(),
          type: 'bypassed',
          address: form.address.trim() || undefined,
          comment: form.comment.trim() || undefined,
          limiteMontanteBps: enBits(form.montant),
          limiteDescendanteBps: enBits(form.descendant),
        },
        currentId,
      ),
    onSuccess: (r) => {
      setErreur(null);
      setCompteRendu(
        r.file
          ? `${form.macAddress} passe sans ticket, limité par la file « ${r.file.name} ».`
          : `${form.macAddress} passe sans ticket, sans limite de débit.`,
      );
      setForm({ macAddress: '', address: '', comment: '', montant: '', descendant: '' });
      rafraichir();
    },
    onError: (e) =>
      setErreur(e instanceof ApiError ? e.message : 'Le routeur a refusé.'),
  });

  const supprimer = useMutation({
    mutationFn: (id: string) => hotspotTabsApi.supprimerContournement(id, currentId),
    onSuccess: (r) => {
      setErreur(null);
      setCompteRendu(
        r.fileRetiree
          ? `Contournement retiré, ainsi que sa file « ${r.fileRetiree} ».`
          : 'Contournement retiré.',
      );
      rafraichir();
    },
    onError: (e) =>
      setErreur(e instanceof ApiError ? e.message : 'Le routeur a refusé.'),
  });

  const requête = useQuery({
    queryKey: ['ip-bindings', currentId],
    queryFn: () => hotspotTabsApi.ipBindings(currentId),
    enabled: Boolean(currentId),
    refetchInterval: 60_000,
  });
  const appareils = useQuery({ queryKey: ['devices'], queryFn: devicesApi.list });

  /**
   * Ce que le routeur voit en ce moment, pour ne plus taper une MAC.
   *
   * **Une MAC recopiee a la main est fausse une fois sur deux.** Android et
   * iOS tirent une adresse differente par reseau Wi-Fi depuis quelques
   * annees : celle que le proprietaire lit dans les reglages de son telephone
   * n'est pas celle que voit le routeur. Le contournement est alors pose, il
   * ne correspond a rien, et l'appareil continue de voir le portail --
   * << action requise >>, sans que rien n'explique pourquoi.
   *
   * Les baux DHCP portent en plus le **nom** de l'appareil, qui est la seule
   * chose qu'un exploitant reconnaisse : << Galaxy-A12 >> se choisit,
   * << 00:65:29:C4:A8:11 >> se recopie mal.
   */
  const hotes = useQuery({
    queryKey: ['hotspot-hosts', currentId],
    queryFn: () => hotspotTabsApi.hosts(currentId),
    enabled: Boolean(currentId),
    refetchInterval: 30_000,
  });
  const baux = useQuery({
    queryKey: ['dhcp-leases', currentId],
    queryFn: () => hotspotTabsApi.dhcpLeases(currentId),
    enabled: Boolean(currentId),
    refetchInterval: 30_000,
  });

  const joignables = appareilsJoignables(hotes.data ?? [], baux.data ?? []);

  if (requête.isError) return <PanneDuRouteur requête={requête} />;

  const bindings = requête.data ?? [];
  const parMac = new Map((appareils.data ?? []).map((d) => [clé(d.macAddress), d]));

  const rapprochés: Rapproché[] = bindings.map((binding: IpBinding) => ({
    binding,
    appareil: parMac.get(clé(binding.macAddress)),
  }));

  const contournements = rapprochés.filter(
    ({ binding }) => binding.type === 'bypassed' && !binding.disabled,
  );
  const bloqués = rapprochés.filter(({ binding }) => binding.type === 'blocked');
  // Le cas qui coûte de l'argent : un accès permanent qu'aucun abonnement de
  // la plateforme ne soutient. Rien ne l'interrompra le mois où le client
  // cesse de payer, parce que rien ne sait qu'il devait payer.
  const sansAbonnement = contournements.filter(
    ({ appareil }) => !appareil || !appareil.subscriptionId,
  );

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Les appareils qui passent <strong>avant le portail</strong> : ni ticket, ni session,
        ni échéance. C&apos;est le moyen normal de servir un abonné au mois — et c&apos;est
        aussi un accès qui ne s&apos;arrête jamais tout seul.
      </p>

      {/* Le débit se règle ici, au même geste, et c'est le point : un appareil
          contourné n'a pas de profil, donc aucune des limites qu'un profil
          porte. Revenir la poser plus tard suppose de savoir qu'elle manque —
          et rien ne le dit, l'appareil marche très bien. */}
      <Card title="Faire passer un appareil sans ticket">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Choisir plutot que recopier. Une MAC tapee a la main est fausse
              une fois sur deux : les telephones tirent une adresse
              differente par reseau, et celle des reglages n'est pas celle
              que voit le routeur. Le champ libre reste, pour un appareil
              eteint au moment du reglage. */}
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">
            Appareil connecté
            <select
              value={form.macAddress}
              onChange={(e) => {
                const choisi = joignables.find((a) => a.mac === e.target.value);
                setForm({
                  ...form,
                  macAddress: e.target.value,
                  address: choisi?.adresse ?? form.address,
                  comment: form.comment || choisi?.nom || '',
                });
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">— choisir dans la liste, ou taper ci-dessous —</option>
              {joignables.map((a) => (
                <option key={a.mac} value={a.mac}>
                  {a.nom ? `${a.nom} — ` : ''}
                  {a.mac}
                  {a.adresse ? ` — ${a.adresse}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Adresse MAC
            <input
              value={form.macAddress}
              onChange={(e) => setForm({ ...form, macAddress: e.target.value })}
              placeholder="AA:BB:CC:DD:EE:FF"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Adresse fixe <span className="font-normal text-slate-400">(exigée pour limiter)</span>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="192.168.88.50"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Description
            <input
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              placeholder="Caisse, télévision, gérant…"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Débit descendant <span className="font-normal text-slate-400">Mbit/s</span>
            <input
              value={form.descendant}
              onChange={(e) => setForm({ ...form, descendant: e.target.value })}
              placeholder="4"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Débit montant <span className="font-normal text-slate-400">Mbit/s</span>
            <input
              value={form.montant}
              onChange={(e) => setForm({ ...form, montant: e.target.value })}
              placeholder="1"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-end">
            <Button
              disabled={!form.macAddress.trim() || creer.isPending}
              onClick={() => creer.mutate()}
            >
              {creer.isPending ? 'Écriture sur le routeur…' : 'Faire passer cet appareil'}
            </Button>
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-xs text-slate-500">
          Laissez les deux débits vides pour un accès sans limite. Les deux vont ensemble :
          RouterOS ne connaît qu&apos;un seul réglage à deux membres, qu&apos;il remplace en
          entier — n&apos;en donner qu&apos;un effacerait l&apos;autre.
        </p>
        {compteRendu && (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {compteRendu}
          </p>
        )}
        {erreur && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">{erreur}</p>
        )}
      </Card>

      {requête.isPending ? (
        <Card>
          <TableSkeleton columns={4} />
        </Card>
      ) : (
        <>
          {sansAbonnement.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>
                {sansAbonnement.length === 1
                  ? 'Un accès permanent n’est rattaché à aucun abonnement suivi par la console.'
                  : `Aucun des ${sansAbonnement.length} accès permanents n’est rattaché à un abonnement suivi par la console.`}
              </strong>{' '}
              Certains sont sûrement voulus — un poste de travail, du matériel à vous. Le
              problème est que <strong>rien ne les distingue d&apos;un client au mois</strong> :
              tous continueront de fonctionner quoi qu&apos;il arrive, et le jour où l&apos;un
              cesse de payer, rien ne le coupe. Ce qui les décrit aujourd&apos;hui est un
              commentaire libre sur le routeur, que personne ne relit.
            </div>
          )}

          <Card title={`${contournements.length} accès permanent(s)`}>
            {contournements.length === 0 ? (
              <p className="text-sm text-slate-600">
                Aucun appareil ne contourne le portail. Tout le monde passe par un ticket.
              </p>
            ) : (
              <Table
                head={['Appareil', 'Ce qui le décrit', 'Appliqué', 'Suivi par la console', '']}
              >
                {contournements.map(({ binding, appareil }) => (
                  <tr key={binding.id}>
                    <td className="px-3 py-2 font-mono text-xs font-medium">
                      {binding.macAddress}
                      {binding.address && (
                        <div className="mt-0.5 font-sans text-slate-500">{binding.address}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {/* Le commentaire du routeur est souvent la SEULE trace
                          de qui est derrière l'appareil : le montrer tel quel
                          plutôt que de le résumer. */}
                      {binding.comment || (
                        <span className="text-slate-400">aucune description</span>
                      )}
                    </td>
                    {/* **La seule question qu'on se pose devant cet ecran.**
                        Le routeur dit lui-meme, dans sa table des hotes, s'il
                        applique le contournement a cet appareil. Sans cette
                        colonne, une MAC fausse -- le cas le plus frequent,
                        les telephones en tirant une par reseau -- donne une
                        ligne d'apparence parfaite pendant que l'appareil
                        continue de voir le portail. On cherche alors du cote
                        du routeur, du pare-feu, du Walled Garden : partout
                        sauf a l'endroit ou personne ne regarde. */}
                    <td className="px-3 py-2">
                      {(() => {
                        const hôte = (hotes.data ?? []).find(
                          (h) => clé(h.macAddress) === clé(binding.macAddress),
                        );
                        if (!hôte) {
                          return (
                            <span title="Cet appareil n’a pas parlé au routeur depuis son dernier redémarrage. Allumé et connecté, il devrait apparaître ici : sinon, l’adresse MAC ne correspond à aucun appareil de ce réseau.">
                              <Badge tone="slate">appareil jamais vu</Badge>
                            </span>
                          );
                        }
                        return hôte.bypassed ? (
                          <Badge tone="green">oui</Badge>
                        ) : (
                          <span title="Le routeur voit cet appareil mais ne le laisse pas passer. Il doit se reconnecter au Wi-Fi pour que le contournement prenne effet.">
                            <Badge tone="amber">pas encore</Badge>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      {appareil?.subscriptionId ? (
                        <Badge tone="green">abonnement suivi</Badge>
                      ) : appareil ? (
                        <Badge tone="amber">appareil connu, sans abonnement</Badge>
                      ) : (
                        <Badge tone="amber">inconnu de la console</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* Retire aussi la file d'attente. Sans cela elle
                          survit à l'appareil et vise une adresse que le
                          prochain bail DHCP donnera à quelqu'un d'autre. */}
                      <Button
                        variant="secondary"
                        disabled={supprimer.isPending}
                        onClick={() => supprimer.mutate(binding.id)}
                      >
                        Retirer
                      </Button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          {bloqués.length > 0 && (
            <Card title={`${bloqués.length} appareil(s) bloqué(s)`}>
              <p className="mb-3 max-w-3xl text-sm text-slate-600">
                Ceux-là sont arrêtés au routeur : même avec un ticket valide, ils
                n&apos;obtiendront rien.
              </p>
              <Table head={['Appareil', 'Ce qui le décrit', 'État']}>
                {bloqués.map(({ binding }) => (
                  <tr key={binding.id}>
                    <td className="px-3 py-2 font-mono text-xs font-medium">
                      {binding.macAddress}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {binding.comment || <span className="text-slate-400">aucune description</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={binding.disabled ? 'slate' : 'red'}>
                        {binding.disabled ? 'règle désactivée' : 'bloqué'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          <p className="max-w-3xl text-xs text-slate-500">
            Cette liste vient du routeur, et non des baux DHCP : un appareil éteint y figure
            quand même. C&apos;est la différence avec l&apos;écran <em>Appareils</em>, qui ne
            montre que ce qui est connecté — un bail dure une heure ici.
          </p>
        </>
      )}
    </div>
  );
}
