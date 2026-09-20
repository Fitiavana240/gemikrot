import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatBits,
  routerToolsApi,
  type FirewallRule,
  type NiveauConstat,
  type ResultatReparation,
} from '../api/router-tools';
import { formatDuree, formatOctets } from '../api/mikrotik-tabs';
import { ListeDuRouteur } from '../components/ListeDuRouteur';
import { useRouterSelection } from '../routers/RouterContext';
import { WifiTab } from './WifiTab';
import { TunnelTab } from './TunnelTab';
import { StructureTab } from './StructureTab';
import { TabBar, type TabDef } from '../components/TabBar';
import {
  Badge,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  Table,
  TableSkeleton,
} from '../components/ui';

/**
 * Ce que WinBox montre sous Queues, Interfaces, Log et IP.
 *
 * **Lecture seule, par décision.** Modifier une file ou un service depuis la
 * console suppose de comprendre ce qu'on casse sur un routeur qui sert des
 * centaines de clients. Ces écrans servent à comprendre, pas à agir — et
 * savoir *pourquoi* un client se plaint vaut souvent mieux que de pouvoir
 * changer un réglage au hasard.
 */


function QueuesTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-queues', currentId],
    queryFn: () => routerToolsApi.queues(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Le débit réellement alloué, client par client. Une file entre chevrons a été créée par le
        HotSpot à l'ouverture d'une session : elle disparaît à la déconnexion et se refait à la
        suivante — la modifier n'aurait aucun effet durable.
      </p>
      <ListeDuRouteur
        requête={requête}
        colonnes={['File', 'Cible', 'Plafond ↓', 'Plafond ↑', 'En ce moment ↓', 'Consommé', 'Origine']}
        vide={{
          titre: 'Aucune file',
          aide: "Le débit n'est plafonné pour personne : chaque client prend ce qu'il peut.",
        }}
        ligne={(q) => (
          <tr key={q.id} className={q.disabled ? 'opacity-60' : undefined}>
            <td className="max-w-[14rem] truncate px-3 py-2 font-mono text-xs">{q.name}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">{q.target}</td>
            <td className="px-3 py-2 tabular-nums">{formatBits(q.maxLimit.descendant)}</td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {formatBits(q.maxLimit.montant)}
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {q.rate.descendant ? formatBits(q.rate.descendant) : '—'}
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">
              {formatOctets(q.bytes.descendant)}
            </td>
            <td className="px-3 py-2">
              <Badge tone={q.dynamic ? 'slate' : 'green'}>
                {q.dynamic ? 'HotSpot' : 'posée à la main'}
              </Badge>
            </td>
          </tr>
        )}
      />
    </div>
  );
}

function LogTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-log', currentId],
    queryFn: () => routerToolsApi.log(currentId!, 200),
    enabled: Boolean(currentId),
    refetchInterval: 20_000,
  });

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Ce que le routeur a noté, du plus récent au plus ancien. C'est ici qu'on lit pourquoi un
        client a été déconnecté, ou pourquoi une authentification a échoué. Les heures sont celles
        du routeur.
      </p>
      <ListeDuRouteur
        requête={requête}
        colonnes={['Quand', 'Sujets', 'Message']}
        vide={{ titre: 'Journal vide' }}
        ligne={(l) => (
          <tr key={l.id} className={l.isProblem ? 'bg-red-50/40' : undefined}>
            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
              {l.time}
            </td>
            <td className="px-3 py-2">
              <span className="flex flex-wrap gap-1">
                {l.topics.map((t) => (
                  <Badge key={t} tone={l.isProblem ? 'red' : 'slate'}>
                    {t}
                  </Badge>
                ))}
              </span>
            </td>
            <td className="px-3 py-2 text-xs">{l.message}</td>
          </tr>
        )}
      />
    </div>
  );
}

function InterfacesTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-interfaces', currentId],
    queryFn: () => routerToolsApi.interfaces(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 20_000,
  });

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Les liens du routeur et ce qui y passe. La colonne <em>Coupures</em> est la plus utile :
        un compteur qui grimpe sur le lien montant explique des plaintes que rien d'autre
        n'explique.
      </p>
      <ListeDuRouteur
        requête={requête}
        colonnes={['Interface', 'Type', 'État', 'Reçu', 'Envoyé', 'Erreurs', 'Coupures', 'Depuis']}
        vide={{ titre: 'Aucune interface' }}
        ligne={(i) => (
          <tr key={i.id} className={i.disabled ? 'opacity-60' : undefined}>
            <td className="px-3 py-2 font-medium">{i.name}</td>
            <td className="px-3 py-2 text-slate-500">{i.type}</td>
            <td className="px-3 py-2">
              <Badge tone={i.disabled ? 'slate' : i.running ? 'green' : 'red'}>
                {i.disabled ? 'désactivée' : i.running ? 'active' : 'lien coupé'}
              </Badge>
            </td>
            <td className="px-3 py-2 tabular-nums text-slate-500">{formatOctets(i.rxBytes)}</td>
            <td className="px-3 py-2 tabular-nums text-slate-500">{formatOctets(i.txBytes)}</td>
            <td className="px-3 py-2 tabular-nums">
              <span className={i.rxErrors + i.txErrors > 0 ? 'text-amber-700' : 'text-slate-400'}>
                {i.rxErrors + i.txErrors}
              </span>
            </td>
            <td className="px-3 py-2 tabular-nums">
              <span className={i.linkDowns > 0 ? 'font-medium text-amber-700' : 'text-slate-400'}>
                {i.linkDowns}
              </span>
            </td>
            <td className="px-3 py-2 text-xs text-slate-500">{i.lastLinkUpTime ?? '—'}</td>
          </tr>
        )}
      />
    </div>
  );
}

function AccesTab() {
  const { currentId } = useRouterSelection();
  const services = useQuery({
    queryKey: ['tools-services', currentId],
    queryFn: () => routerToolsApi.services(currentId!),
    enabled: Boolean(currentId),
  });
  const cloud = useQuery({
    queryKey: ['tools-cloud', currentId],
    queryFn: () => routerToolsApi.cloud(currentId!),
    enabled: Boolean(currentId),
    retry: false,
  });

  const actifs = (services.data ?? []).filter((s) => !s.disabled);

  return (
    <div className="space-y-4">
      <Card title="Nom DNS fourni par MikroTik">
        {cloud.isPending ? (
          <p className="text-sm text-slate-400">Lecture…</p>
        ) : cloud.isError ? (
          <p className="text-sm text-slate-500">Le routeur n'a pas répondu.</p>
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Field label="Service">{cloud.data!.ddnsEnabled}</Field>
              <Field label="Nom attribué">
                {cloud.data!.dnsName ?? <span className="text-slate-400">aucun</span>}
              </Field>
              <Field label="Adresse publique">
                {cloud.data!.publicAddress ?? <span className="text-slate-400">inconnue</span>}
              </Field>
            </dl>
            {!cloud.data!.dnsName && (
              <p className="mt-3 text-xs text-slate-500">
                Aucun nom n'est attribué. Activé, ce service donnerait au routeur une adresse
                stable même sans IP fixe — une alternative au tunnel pour l'atteindre à distance.
              </p>
            )}
          </>
        )}
      </Card>

      <div className="space-y-2">
        <p className="max-w-3xl text-sm text-slate-600">
          Les portes d'administration du routeur. La colonne <em>Depuis</em> est celle qui compte :
          vide, elle autorise <strong>toutes</strong> les adresses — ce qui n'est pas la même chose
          qu'aucune, et c'est la confusion qui a déjà coupé l'accès à cette application.
        </p>
        <ListeDuRouteur
          requête={{ ...services, data: actifs }}
          colonnes={['Service', 'Port', 'Depuis', 'Certificat', 'Sessions']}
          vide={{ titre: 'Aucun service actif' }}
          ligne={(s) => (
            <tr key={s.id}>
              <td className="px-3 py-2 font-medium">{s.name}</td>
              <td className="px-3 py-2 tabular-nums">
                {s.port ?? '—'}
                <span className="ml-1 text-xs text-slate-400">{s.protocol}</span>
              </td>
              <td className="px-3 py-2">
                {s.availableFrom.length === 0 ? (
                  <Badge tone="amber">toutes les adresses</Badge>
                ) : (
                  <span className="font-mono text-xs text-slate-600">
                    {s.availableFrom.join(', ')}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-slate-500">{s.certificate ?? '—'}</td>
              <td className="px-3 py-2 tabular-nums text-slate-500">{s.maxSessions ?? '—'}</td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}

function AppareilsTab() {
  const { currentId } = useRouterSelection();
  const arp = useQuery({
    queryKey: ['tools-arp', currentId],
    queryFn: () => routerToolsApi.arp(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 30_000,
  });
  const serveurs = useQuery({
    queryKey: ['tools-dhcp', currentId],
    queryFn: () => routerToolsApi.dhcpServers(currentId!),
    enabled: Boolean(currentId),
  });

  return (
    <div className="space-y-4">
      <Card title="Serveurs DHCP">
        {serveurs.isPending ? (
          <p className="text-sm text-slate-400">Lecture…</p>
        ) : (serveurs.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">Aucun serveur DHCP déclaré.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {serveurs.data!.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium">{d.name}</span>
                <span className="text-slate-500">sur {d.interfaceName}</span>
                <span className="text-slate-500">bassin {d.addressPool ?? '—'}</span>
                <span className="text-slate-500">bail {d.leaseTime ?? '—'}</span>
                {d.invalid && <Badge tone="red">invalide</Badge>}
                {d.disabled && <Badge tone="slate">désactivé</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="space-y-2">
        <p className="max-w-3xl text-sm text-slate-600">
          Quelle adresse répond sur quel matériel. Une entrée apprise du trafic disparaît d'elle-même ;
          une entrée posée à la main reste, et c'est ainsi qu'on réserve une adresse à un appareil.
        </p>
        <ListeDuRouteur
          requête={arp}
          colonnes={['Adresse', 'Matériel', 'Interface', 'État', 'Origine']}
          vide={{ titre: 'Table ARP vide' }}
          ligne={(a) => (
            <tr key={a.id}>
              <td className="px-3 py-2 font-mono text-xs">{a.address}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-600">
                {a.macAddress ?? <span className="text-slate-400">inconnu</span>}
              </td>
              <td className="px-3 py-2 text-slate-500">{a.interfaceName}</td>
              <td className="px-3 py-2">
                <Badge tone={a.complete ? 'green' : 'amber'}>{a.status ?? '—'}</Badge>
              </td>
              <td className="px-3 py-2">
                <Badge tone={a.fromDhcp ? 'green' : a.dynamic ? 'slate' : 'amber'}>
                  {a.fromDhcp ? 'DHCP' : a.dynamic ? 'apprise' : 'posée à la main'}
                </Badge>
              </td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}

function TableFirewall({
  requête,
  intro,
}: {
  requête: ReturnType<typeof useQuery<FirewallRule[]>>;
  intro: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">{intro}</p>
      <ListeDuRouteur
        requête={requête}
        colonnes={['#', 'Chaîne', 'Action', 'Condition', 'Trafic', 'Origine']}
        vide={{
          titre: 'Aucune règle',
          aide: "La chaîne est vide : tout passe, rien n'est filtré.",
        }}
        ligne={(r) => {
          const condition = [
            r.protocol,
            r.srcAddress && `de ${r.srcAddress}`,
            r.dstAddress && `vers ${r.dstAddress}`,
            r.dstPort && `port ${r.dstPort}`,
            r.inInterface && `entrant ${r.inInterface}`,
            r.outInterface && `sortant ${r.outInterface}`,
          ]
            .filter(Boolean)
            .join(' · ');

          return (
            <tr key={r.id} className={r.disabled ? 'opacity-50' : undefined}>
              {/* La position est l'information la plus importante d'une règle :
                  la première qui correspond décide. */}
              <td className="px-3 py-2 tabular-nums text-slate-400">{r.position}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.chain}</td>
              <td className="px-3 py-2">
                <span className="font-medium">{r.action}</span>
                {r.jumpTarget && (
                  <span className="ml-1 font-mono text-xs text-slate-500">→ {r.jumpTarget}</span>
                )}
              </td>
              <td className="max-w-[20rem] truncate px-3 py-2 text-xs text-slate-500">
                {condition || <span className="text-slate-300">tout</span>}
                {r.comment && <span className="ml-1 italic text-slate-400">— {r.comment}</span>}
              </td>
              <td className="px-3 py-2 tabular-nums text-slate-500">{formatOctets(r.bytes)}</td>
              <td className="px-3 py-2">
                {r.hotspot ? (
                  <Badge tone="slate">HotSpot</Badge>
                ) : r.dynamic ? (
                  <Badge tone="slate">automatique</Badge>
                ) : (
                  <Badge tone="green">posée à la main</Badge>
                )}
              </td>
            </tr>
          );
        }}
      />
    </div>
  );
}

function PareFeuTab() {
  const { currentId } = useRouterSelection();
  const [chaîne, setChaîne] = useState<'filter' | 'nat'>('filter');

  const filtre = useQuery({
    queryKey: ['tools-fw-filter', currentId],
    queryFn: () => routerToolsApi.firewallFilter(currentId!),
    enabled: Boolean(currentId) && chaîne === 'filter',
  });
  const nat = useQuery({
    queryKey: ['tools-fw-nat', currentId],
    queryFn: () => routerToolsApi.firewallNat(currentId!),
    enabled: Boolean(currentId) && chaîne === 'nat',
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        {(
          [
            ['filter', 'Filtrage'],
            ['nat', 'Traduction (NAT)'],
          ] as const
        ).map(([clé, libellé]) => (
          <button
            key={clé}
            type="button"
            onClick={() => setChaîne(clé)}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              chaîne === clé ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {libellé}
          </button>
        ))}
      </div>

      {chaîne === 'filter' ? (
        <TableFirewall
          requête={filtre}
          intro={
            <>
              Ce que le routeur laisse passer, et dans quel ordre. La colonne <strong>#</strong> est
              la plus importante : la <em>première</em> règle qui correspond décide, les suivantes
              ne sont jamais lues. Les règles marquées <em>HotSpot</em> sont refaites par le portail
              à chaque démarrage — les modifier à la main ne tient pas.
            </>
          }
        />
      ) : (
        <TableFirewall
          requête={nat}
          intro={
            <>
              La traduction d'adresses. C'est ici que vit la redirection vers le portail captif —
              la règle <code className="rounded bg-slate-100 px-1">dstnat</code> qui détourne le
              trafic des clients non authentifiés — et le{' '}
              <code className="rounded bg-slate-100 px-1">masquerade</code> qui fait sortir tout le
              monde derrière l'adresse du fournisseur.
            </>
          }
        />
      )}
    </div>
  );
}

function DnsTab() {
  const { currentId } = useRouterSelection();
  const réglages = useQuery({
    queryKey: ['tools-dns', currentId],
    queryFn: () => routerToolsApi.dns(currentId!),
    enabled: Boolean(currentId),
  });
  const statiques = useQuery({
    queryKey: ['tools-dns-static', currentId],
    queryFn: () => routerToolsApi.dnsStatic(currentId!),
    enabled: Boolean(currentId),
  });

  const d = réglages.data;

  return (
    <div className="space-y-4">
      <Card title="Résolution">
        {réglages.isPending ? (
          <p className="text-sm text-slate-400">Lecture…</p>
        ) : réglages.isError ? (
          <p className="text-sm text-slate-500">Le routeur n'a pas répondu.</p>
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Serveurs déclarés">
                {d!.servers.length ? (
                  <span className="font-mono text-xs">{d!.servers.join(', ')}</span>
                ) : (
                  <span className="text-slate-400">aucun</span>
                )}
              </Field>
              <Field label="Reçus du fournisseur">
                {d!.dynamicServers.length ? (
                  <span className="font-mono text-xs">{d!.dynamicServers.join(', ')}</span>
                ) : (
                  <span className="text-slate-400">aucun</span>
                )}
              </Field>
              <Field label="Cache">
                {d!.cacheSize != null ? (
                  <span className="tabular-nums">
                    {d!.cacheUsed ?? 0} / {d!.cacheSize} Kio
                  </span>
                ) : (
                  '—'
                )}
              </Field>
              <Field label="Répond aux autres">
                <Badge tone={d!.allowRemoteRequests ? 'green' : 'slate'}>
                  {d!.allowRemoteRequests ? 'oui' : 'non'}
                </Badge>
              </Field>
            </dl>
            {d!.useDohServer && (
              <p className="mt-3 text-xs text-slate-500">
                Les requêtes passent par DNS sur HTTPS ({d!.useDohServer}), vérification du
                certificat {d!.verifyDohCert ? 'activée' : 'désactivée'}.
              </p>
            )}
            {/* Ne pas affirmer qu'un « non » casse le portail : sur le hAP du
                parc ce réglage est à non, et le HotSpot sert des centaines de
                comptes — il intercepte le DNS lui-même. */}
            {!d!.allowRemoteRequests && (
              <p className="mt-3 text-xs text-slate-500">
                Le routeur ne résout que pour lui-même. Ce n'est pas une anomalie : le portail
                captif intercepte le DNS de ses clients sans passer par ce réglage.
              </p>
            )}
          </>
        )}
      </Card>

      <div className="space-y-2">
        <p className="max-w-3xl text-sm text-slate-600">
          Les noms que le routeur résout lui-même, avant d'interroger qui que ce soit. Les entrées{' '}
          <em>automatiques</em> sont posées par le portail pour son propre nom.
        </p>
        <ListeDuRouteur
          requête={statiques}
          colonnes={['Nom', 'Type', 'Adresse', 'Durée de vie', 'Origine']}
          vide={{
            titre: 'Aucune entrée statique',
            aide: 'Tous les noms sont résolus par les serveurs déclarés plus haut.',
          }}
          ligne={(e) => (
            <tr key={e.id} className={e.disabled ? 'opacity-50' : undefined}>
              <td className="px-3 py-2 font-mono text-xs">{e.name ?? '—'}</td>
              <td className="px-3 py-2 text-slate-500">{e.type ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-xs">{e.address ?? '—'}</td>
              <td className="px-3 py-2 tabular-nums text-slate-500">{formatDuree(e.ttlSeconds)}</td>
              <td className="px-3 py-2">
                <Badge tone={e.dynamic ? 'slate' : 'green'}>
                  {e.dynamic ? 'automatique' : 'posée à la main'}
                </Badge>
              </td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}

function RoutesTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-routes', currentId],
    queryFn: () => routerToolsApi.routes(currentId!),
    enabled: Boolean(currentId),
  });

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Par où sort le trafic. La ligne <code className="rounded bg-slate-100 px-1">0.0.0.0/0</code>{' '}
        est la sortie vers Internet : sa passerelle est celle du fournisseur. Une route{' '}
        <em>inactive</em> existe mais ne sert pas — c'est souvent le signe d'un lien tombé.
      </p>
      <ListeDuRouteur
        requête={requête}
        colonnes={['Destination', 'Par', 'Distance', 'Table', 'Origine', 'État']}
        vide={{ titre: 'Aucune route', aide: 'Le routeur ne sait joindre aucun réseau.' }}
        ligne={(r) => (
          <tr key={r.id} className={r.active ? undefined : 'opacity-50'}>
            <td className="px-3 py-2 font-mono text-xs">
              {r.dstAddress}
              {r.dstAddress === '0.0.0.0/0' && (
                <span className="ml-2 text-[11px] font-sans text-slate-400">(Internet)</span>
              )}
            </td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.immediateGw ?? '—'}</td>
            <td className="px-3 py-2 tabular-nums text-slate-500">{r.distance ?? '—'}</td>
            <td className="px-3 py-2 text-slate-500">{r.routingTable ?? '—'}</td>
            <td className="px-3 py-2">
              <Badge tone={r.isStatic ? 'green' : 'slate'}>
                {r.connect
                  ? 'connectée'
                  : r.dhcp
                    ? 'du fournisseur'
                    : r.isStatic
                      ? 'posée à la main'
                      : 'automatique'}
              </Badge>
            </td>
            <td className="px-3 py-2">
              <Badge tone={r.active ? 'green' : 'amber'}>{r.active ? 'active' : 'inactive'}</Badge>
            </td>
          </tr>
        )}
      />
    </div>
  );
}

/** Une jauge simple. Le rouge commence là où il ne reste plus de marge utile. */
function Jauge({ libellé, utilisé, total }: { libellé: string; utilisé: number; total: number }) {
  const part = total > 0 ? Math.min(utilisé / total, 1) : 0;
  const ton = part > 0.95 ? 'bg-red-500' : part > 0.8 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-slate-600">{libellé}</span>
        <span className="tabular-nums text-slate-500">
          {formatOctets(total - utilisé)} libres sur {formatOctets(total)}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${ton}`} style={{ width: `${Math.round(part * 100)}%` }} />
      </div>
    </div>
  );
}

const TON_CONSTAT: Record<NiveauConstat, 'red' | 'amber' | 'green'> = {
  bloquant: 'red',
  avertissement: 'amber',
  ok: 'green',
};

const BORDURE_CONSTAT: Record<NiveauConstat, string> = {
  bloquant: 'border-red-200 bg-red-50',
  avertissement: 'border-amber-200 bg-amber-50',
  ok: 'border-emerald-200 bg-emerald-50',
};

// Du gris sur un fond coloré paraît délavé. Le texte prend une teinte
// sombre de sa propre couleur, ce qui reste lisible et garde le code
// couleur du niveau.
const TITRE_CONSTAT: Record<NiveauConstat, string> = {
  bloquant: 'text-red-950',
  avertissement: 'text-amber-950',
  ok: 'text-emerald-950',
};

const TEXTE_CONSTAT: Record<NiveauConstat, string> = {
  bloquant: 'text-red-900',
  avertissement: 'text-amber-900',
  ok: 'text-emerald-900',
};

/**
 * Stockage et état de User Manager.
 *
 * Cet écran existe pour une raison précise du parc : la mémoire interne d'un
 * hAP ac² fait 16 Mio et se remplit, si bien que la base User Manager finit
 * sur une clé USB. Cela marche — et cela crée une dépendance matérielle que
 * personne ne voit tant qu'elle tient.
 */
function StockageTab() {
  const { currentId } = useRouterSelection();
  const client = useQueryClient();
  const état = useQuery({
    queryKey: ['tools-um-readiness', currentId],
    queryFn: () => routerToolsApi.userManagerReadiness(currentId!),
    enabled: Boolean(currentId),
  });

  /**
   * Le résultat de la dernière réparation, gardé à l'écran.
   *
   * Il compte autant que le succès : le serveur relit l'état du routeur après
   * avoir écrit, et peut répondre « accepté, mais rien n'a changé ». Faire
   * disparaître ce cas derrière un rafraîchissement silencieux renverrait
   * chercher la panne ailleurs.
   */
  const [dernier, setDernier] = useState<ResultatReparation | { erreur: string } | null>(null);

  const réparer = useMutation({
    mutationFn: (code: string) => routerToolsApi.appliquerReparation(currentId!, code),
    onSuccess: (résultat) => {
      setDernier(résultat);
      client.setQueryData(['tools-um-readiness', currentId], résultat.etat);
      void client.invalidateQueries({ queryKey: ['tools-storage', currentId] });
    },
    onError: (erreur: unknown) => {
      setDernier({ erreur: erreur instanceof Error ? erreur.message : String(erreur) });
    },
  });
  const stockage = useQuery({
    queryKey: ['tools-storage', currentId],
    queryFn: () => routerToolsApi.storage(currentId!),
    enabled: Boolean(currentId),
  });

  if (état.isPending || stockage.isPending) return <TableSkeleton columns={4} rows={4} />;
  if (état.isError || stockage.isError) {
    return (
      <ErrorNote onRetry={() => void (état.refetch(), stockage.refetch())}>
        Le routeur n'a pas répondu — ces chiffres sont lus en direct.
      </ErrorNote>
    );
  }

  const e = état.data!;
  const s = stockage.data!;

  return (
    <div className="space-y-4">
      {dernier && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            'erreur' in dernier || !dernier.appliquee
              ? 'border-red-300 bg-red-50 text-red-900'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900'
          }`}
        >
          {'erreur' in dernier ? dernier.erreur : dernier.message}
        </div>
      )}

      <div className="space-y-2">
        {e.constats.length === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            Rien à signaler : User Manager est installé, allumé, et son support a de la place.
          </div>
        ) : (
          e.constats.map((c) => (
            <div key={c.code} className={`rounded-lg border p-3 ${BORDURE_CONSTAT[c.niveau]}`}>
              <div className="flex items-center gap-2">
                <Badge tone={TON_CONSTAT[c.niveau]}>
                  {c.niveau === 'ok' ? 'à savoir' : c.niveau}
                </Badge>
                <span className={`text-sm font-semibold ${TITRE_CONSTAT[c.niveau]}`}>
                  {c.titre}
                </span>
              </div>
              <p className={`mt-1.5 max-w-3xl text-sm ${TEXTE_CONSTAT[c.niveau]}`}>{c.detail}</p>

              {c.reparation ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => réparer.mutate(c.reparation!)}
                    disabled={réparer.isPending}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                  >
                    {réparer.isPending && réparer.variables === c.reparation
                      ? 'Application…'
                      : 'Corriger depuis la console'}
                  </button>
                  {/* La commande reste montrée à côté du bouton : l'exploitant
                      doit pouvoir voir ce qui va être écrit avant de cliquer,
                      et la repasser à la main si la console échoue. */}
                  <code className="overflow-x-auto rounded bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-100">
                    {c.commande}
                  </code>
                </div>
              ) : (
                c.commande && (
                  <div className="mt-2">
                    <p className={`text-[11px] uppercase tracking-wide ${TEXTE_CONSTAT[c.niveau]}`}>
                      À passer dans le terminal du routeur
                    </p>
                    <code className="mt-1 block overflow-x-auto rounded bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100">
                      {c.commande}
                    </code>
                  </div>
                )
              )}
            </div>
          ))
        )}
      </div>

      {/* Le micrologiciel d'amorçage vit à côté de RouterOS et se met à jour
          séparément : l'écart ne se voit nulle part sans aller le chercher, pas
          même dans WinBox. Relevé ici — RouterOS 7.24.4, RouterBOOT 6.42.3. */}
      {stockage.data?.routerboard && (
        <Card title="Matériel et micrologiciel">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Modèle">{stockage.data.routerboard.model ?? '—'}</Field>
            <Field label="Numéro de série">
              <span className="font-mono text-xs">
                {stockage.data.routerboard.serialNumber ?? '—'}
              </span>
            </Field>
            <Field label="RouterOS">{stockage.data.version ?? '—'}</Field>
            <Field label="Micrologiciel d'amorçage">
              {stockage.data.routerboard.currentFirmware ?? '—'}{' '}
              {stockage.data.routerboard.miseANiveauDisponible && (
                <Badge tone="amber">
                  {stockage.data.routerboard.upgradeFirmware} disponible
                </Badge>
              )}
            </Field>
          </dl>

          {stockage.data.routerboard.miseANiveauDisponible && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <p>
                Le micrologiciel d'amorçage est resté en{' '}
                <strong>{stockage.data.routerboard.currentFirmware}</strong> alors que le paquet
                installé porte la version <strong>{stockage.data.routerboard.upgradeFirmware}</strong>.
                Ce n'est pas urgent et rien ne casse en l'état — mais l'écart se creuse à chaque
                mise à niveau de RouterOS.
              </p>
              <p className="mt-1.5 text-[11px] uppercase tracking-wide">
                À passer dans le terminal du routeur, suivi d'un redémarrage
              </p>
              <code className="mt-1 block overflow-x-auto rounded bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100">
                /system routerboard upgrade
              </code>
            </div>
          )}
        </Card>
      )}

      <Card title="User Manager">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Paquet">
            {/* Quatre états et non trois : « disponible » n'est pas
                « installé », et le confondre avec « désactivé » ferait
                prescrire un téléversement là où il n'y a rien à téléverser. */}
            <Badge
              tone={
                e.packageEnabled
                  ? 'green'
                  : e.packageInstalled || e.packageAvailable
                    ? 'amber'
                    : 'red'
              }
            >
              {e.packageEnabled
                ? 'actif'
                : e.packageInstalled
                  ? 'désactivé'
                  : e.packageAvailable
                    ? 'disponible, non installé'
                    : 'absent'}
            </Badge>
            {e.packageVersion && (
              <span className="ml-2 font-mono text-xs text-slate-500">{e.packageVersion}</span>
            )}
            {e.packageScheduled && (
              <span className="ml-2 text-xs text-slate-500">
                {e.packageScheduled === 'enable' ? 'activation' : 'désactivation'} au redémarrage
              </span>
            )}
          </Field>
          <Field label="Service RADIUS">
            <Badge tone={e.serviceEnabled ? 'green' : 'red'}>
              {e.serviceEnabled ? 'allumé' : 'éteint'}
            </Badge>
          </Field>
          <Field label="Profils">
            <Badge tone={e.useProfiles ? 'green' : 'amber'}>
              {e.useProfiles ? 'activés' : 'désactivés'}
            </Badge>
          </Field>
          <Field label="Base de données">
            {e.database ? (
              <span className="font-mono text-xs">{e.database.path}</span>
            ) : (
              <span className="text-slate-400">introuvable</span>
            )}
          </Field>
        </dl>
        {e.database && (
          <p className="mt-3 max-w-3xl text-xs text-slate-500">
            La base occupe {formatOctets(e.database.sizeBytes)} et dispose de{' '}
            {formatOctets(e.database.freeBytes)}. C'est elle qui tient le calendrier des forfaits :
            la validité d'un ticket continue de s'écouler même quand le client est déconnecté — ce
            que le HotSpot seul ne sait pas faire.
          </p>
        )}
      </Card>

      <Card title="Mémoire">
        <div className="space-y-3">
          <Jauge
            libellé="Mémoire interne (flash)"
            utilisé={s.internalTotalBytes - s.internalFreeBytes}
            total={s.internalTotalBytes}
          />
          <Jauge
            libellé="Mémoire vive"
            utilisé={s.memoryTotalBytes - s.memoryFreeBytes}
            total={s.memoryTotalBytes}
          />
        </div>
        {s.parRacine.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Occupation par support</p>
            <ul className="mt-1 space-y-1 text-sm">
              {s.parRacine.map((r) => (
                <li key={r.root} className="flex justify-between text-slate-600">
                  <span className="font-mono text-xs">{r.root}</span>
                  <span className="tabular-nums text-slate-500">
                    {formatOctets(r.bytes)} · {r.fileCount} fichier{r.fileCount > 1 ? 's' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div className="space-y-2">
        <p className="max-w-3xl text-sm text-slate-600">
          Les supports branchés. Seule une partition <strong>montée</strong> est utilisable : une
          clé présente mais non montée est aussi absente qu'une clé retirée.
        </p>
        {s.disks.length === 0 ? (
          <EmptyState
            title="Aucun support externe"
            hint="Rien n'est branché : tout repose sur la mémoire interne."
          />
        ) : (
          <Table head={['Emplacement', 'Nature', 'Système de fichiers', 'Taille', 'Modèle', 'État']}>
            {s.disks.map((d) => (
              <tr key={d.id}>
                <td className="px-3 py-2 font-mono text-xs">{d.slot}</td>
                <td className="px-3 py-2 text-slate-500">
                  {d.isPartition ? 'partition' : 'support'}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {d.fs ?? <span className="text-slate-300">aucun</span>}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-500">
                  {d.sizeBytes != null ? formatOctets(d.sizeBytes) : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{d.model ?? '—'}</td>
                <td className="px-3 py-2">
                  {/* Le support brut n'est jamais « monté » — c'est sa
                      partition qui l'est. Le marquer en rouge ferait croire
                      à une panne sur un montage parfaitement normal. */}
                  {d.isPartition ? (
                    <Badge tone={d.mounted ? 'green' : 'red'}>
                      {d.mounted ? 'montée' : 'non montée'}
                    </Badge>
                  ) : (
                    <Badge tone="slate">porte une partition</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      <Card title="Paquets installés">
        {/* `/system/package` mélange les paquets installés et ceux qui sont
            seulement disponibles dans l'image. Les afficher pêle-mêle noierait
            les trois qui comptent sous seize qui ne tournent pas. */}
        <ul className="space-y-1 text-sm">
          {s.packages
            .filter((p) => p.installed)
            .map((p) => (
              <li key={p.id} className="flex items-center justify-between">
                <span className="font-mono text-xs">{p.name}</span>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="tabular-nums">
                    {p.sizeBytes != null ? formatOctets(p.sizeBytes) : '—'}
                  </span>
                  <span className="font-mono">{p.version ?? '—'}</span>
                  {p.scheduledAction && (
                    <Badge tone={p.scheduledAction === 'enable' ? 'amber' : 'red'}>
                      {p.scheduledAction === 'enable' ? 'activation' : 'désactivation'} au
                      redémarrage
                    </Badge>
                  )}
                  {p.disabled && !p.scheduledAction && <Badge tone="amber">désactivé</Badge>}
                </span>
              </li>
            ))}
        </ul>
        {s.packages.some((p) => !p.installed) && (
          <p className="mt-3 text-xs text-slate-500">
            <strong>{s.packages.filter((p) => !p.installed).length} autres</strong> sont présents
            dans l'image sans être installés :{' '}
            <span className="font-mono">
              {s.packages
                .filter((p) => !p.installed)
                .map((p) => p.name)
                .join(', ')}
            </span>
            . Les activer et redémarrer suffit à les installer — aucun fichier à téléverser.
          </p>
        )}
        <p className="mt-3 max-w-3xl text-xs text-slate-500">
          <strong>User Manager ne fait pas partie de l'image de base de RouterOS.</strong> C'est un
          paquet supplémentaire : tant qu'il n'est pas installé, son menu n'apparaît ni dans WinBox
          ni ici. Un changement de paquet ne prend effet qu'au redémarrage.
        </p>
      </Card>
    </div>
  );
}

/**
 * Les fichiers du routeur, par support.
 *
 * Trié par taille décroissante et non par nom, parce que la question qu'on
 * se pose en ouvrant cet écran est toujours la même : **qu'est-ce qui prend
 * la place ?** Un tri alphabétique obligerait à parcourir cinquante lignes
 * pour trouver les trois qui comptent.
 */
function FichiersTab() {
  const { currentId } = useRouterSelection();
  const [racine, setRacine] = useState<string | null>(null);

  const requête = useQuery({
    queryKey: ['tools-files', currentId],
    queryFn: () => routerToolsApi.files(currentId!),
    enabled: Boolean(currentId),
  });

  const fichiers = requête.data ?? [];

  // Les dossiers et les disques ne pèsent rien et noieraient le classement ;
  // ils restent comptés dans le total de leur racine, où ils ont un sens.
  const réels = fichiers.filter((f) => f.type !== 'directory' && f.type !== 'disk');

  const racines = [...new Set(fichiers.map((f) => f.root))].map((nom) => ({
    nom,
    octets: réels.filter((f) => f.root === nom).reduce((t, f) => t + (f.sizeBytes ?? 0), 0),
    nombre: réels.filter((f) => f.root === nom).length,
  }));

  const visibles = (racine ? réels.filter((f) => f.root === racine) : réels)
    .slice()
    .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Ce qui occupe la place, du plus lourd au plus léger. Sur un routeur dont la mémoire
        interne fait 16 Mio, c'est l'écran qui dit quoi supprimer avant une sauvegarde ou une
        mise à jour. Les dossiers ne sont pas listés : ils ne pèsent rien par eux-mêmes.
      </p>

      {racines.length > 0 && (
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          <button
            type="button"
            onClick={() => setRacine(null)}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              racine === null
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tous ({réels.length})
          </button>
          {racines.map((r) => (
            <button
              key={r.nom}
              type="button"
              onClick={() => setRacine(r.nom)}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                racine === r.nom
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="font-mono text-xs">{r.nom}</span>
              <span className="ml-1.5 text-xs text-slate-500">{formatOctets(r.octets)}</span>
            </button>
          ))}
        </div>
      )}

      <ListeDuRouteur
        requête={{ ...requête, data: visibles }}
        colonnes={['Fichier', 'Type', 'Taille', 'Modifié']}
        vide={{
          titre: 'Aucun fichier',
          aide:
            racine === null
              ? "Le routeur ne rapporte aucun fichier — c'est inhabituel."
              : `Rien sur « ${racine} ».`,
        }}
        ligne={(f) => (
          <tr key={f.id}>
            <td className="max-w-[22rem] truncate px-3 py-2 font-mono text-xs" title={f.name}>
              {f.name}
            </td>
            <td className="px-3 py-2 text-xs text-slate-500">
              {/* RouterOS écrit « .sqlite file » : le point et le mot « file »
                  n'apprennent rien, l'extension seule se lit mieux. */}
              {f.type.replace(/^\./, '').replace(/ file$/, '')}
            </td>
            <td className="px-3 py-2 tabular-nums">
              {f.sizeBytes != null ? formatOctets(f.sizeBytes) : '—'}
            </td>
            <td className="px-3 py-2 text-xs text-slate-500">{f.lastModified ?? '—'}</td>
          </tr>
        )}
      />

      <p className="text-xs text-slate-500">
        Lecture seule. Supprimer un fichier depuis la console supposerait de savoir à quoi
        chacun sert — les pages du portail captif et la base User Manager vivent ici.
      </p>
    </div>
  );
}

const ONGLETS = {
  debit: { titre: 'Débit par client', rendu: () => <QueuesTab /> },
  liens: { titre: 'Interfaces', rendu: () => <InterfacesTab /> },
  structure: { titre: 'Structure du réseau', rendu: () => <StructureTab /> },
  wifi: { titre: 'Wi-Fi et RADIUS', rendu: () => <WifiTab /> },
  tunnel: { titre: 'Tunnel (VPN)', rendu: () => <TunnelTab /> },
  journal: { titre: 'Journal du routeur', rendu: () => <LogTab /> },
  acces: { titre: 'Accès et DDNS', rendu: () => <AccesTab /> },
  appareils: { titre: 'DHCP et ARP', rendu: () => <AppareilsTab /> },
  'pare-feu': { titre: 'Pare-feu', rendu: () => <PareFeuTab /> },
  dns: { titre: 'DNS', rendu: () => <DnsTab /> },
  routes: { titre: 'Routes', rendu: () => <RoutesTab /> },
  stockage: { titre: 'Stockage et User Manager', rendu: () => <StockageTab /> },
  fichiers: { titre: 'Fichiers', rendu: () => <FichiersTab /> },
} as const;

type Tab = keyof typeof ONGLETS;

const BARRE: TabDef[] = Object.entries(ONGLETS).map(([to, { titre }]) => ({ to, label: titre }));

export function RouterToolsPage() {
  const { tab } = useParams();
  const courant: Tab = tab && tab in ONGLETS ? (tab as Tab) : 'debit';
  const { current, isLoading } = useRouterSelection();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Diagnostic"
        description="Ce que le routeur mesure et note. Ces écrans sont en lecture seule : ils servent à comprendre une panne ou une lenteur, pas à changer un réglage — savoir pourquoi un client se plaint vaut mieux que de modifier au hasard."
      />
      {/* Distinguer « pas encore chargé » de « aucun » : afficher le second
          pendant le chargement ferait croire à un parc vide à chaque
          ouverture de l'écran. */}
      {isLoading ? (
        <TableSkeleton columns={5} rows={3} />
      ) : !current ? (
        <EmptyState
          title="Aucun routeur sélectionné"
          hint="Ces tables sont lues en direct : choisissez un routeur dans la barre du haut."
        />
      ) : (
        <>
          <TabBar base="/diagnostic" tabs={BARRE} />
          {ONGLETS[courant].rendu()}
        </>
      )}
    </div>
  );
}
