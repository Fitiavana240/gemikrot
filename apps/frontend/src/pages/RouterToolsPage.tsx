import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatBits, routerToolsApi } from '../api/router-tools';
import { formatOctets } from '../api/mikrotik-tabs';
import { useRouterSelection } from '../routers/RouterContext';
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

/** Affichage commun : attente, erreur, vide, contenu. */
function Liste<T>({
  requête,
  colonnes,
  vide,
  ligne,
}: {
  requête: { isPending: boolean; isError: boolean; data?: T[]; refetch: () => unknown };
  colonnes: string[];
  vide: { titre: string; aide?: string };
  ligne: (item: T) => React.ReactNode;
}) {
  if (requête.isPending) return <TableSkeleton columns={colonnes.length} />;
  if (requête.isError) {
    return (
      <ErrorNote onRetry={() => requête.refetch()}>
        Le routeur n'a pas répondu — cette table est lue en direct, elle n'a pas de copie en base.
      </ErrorNote>
    );
  }
  const lignes = requête.data ?? [];
  if (lignes.length === 0) return <EmptyState title={vide.titre} hint={vide.aide} />;
  return <Table head={colonnes}>{lignes.map(ligne)}</Table>;
}

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
      <Liste
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
      <Liste
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
      <Liste
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
        <Liste
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
        <Liste
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

const ONGLETS = {
  debit: { titre: 'Débit par client', rendu: () => <QueuesTab /> },
  liens: { titre: 'Interfaces', rendu: () => <InterfacesTab /> },
  journal: { titre: 'Journal du routeur', rendu: () => <LogTab /> },
  acces: { titre: 'Accès et DDNS', rendu: () => <AccesTab /> },
  appareils: { titre: 'DHCP et ARP', rendu: () => <AppareilsTab /> },
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
