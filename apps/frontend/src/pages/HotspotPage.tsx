import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatUptime, formatVolume, hotspotApi } from '../api/hotspot';
import { formatDuration } from '../api/user-manager';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Badge, Button, Card, FormField, Input, Table } from '../components/ui';

type Tab = 'serveurs' | 'walled-garden' | 'cookies' | 'sessions';

export function HotspotPage() {
  const [tab, setTab] = useState<Tab>('serveurs');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">HotSpot</h1>
        <p className="mt-1 text-sm text-slate-500">
          La configuration réseau telle qu'elle vit sur le routeur. Rien n'en est recopié ici :
          ces réglages appartiennent au routeur, pas au suivi commercial.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            ['serveurs', 'Serveurs'],
            ['walled-garden', 'Walled Garden'],
            ['cookies', 'Cookies'],
            ['sessions', 'Sessions'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === value
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'serveurs' && <ServersTab />}
      {tab === 'walled-garden' && <WalledGardenTab />}
      {tab === 'cookies' && <CookiesTab />}
      {tab === 'sessions' && <SessionsTab />}
    </div>
  );
}

function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
      {children}
    </div>
  );
}

// ==================== Serveurs ====================

function ServersTab() {
  const overview = useQuery({ queryKey: ['hotspot-overview'], queryFn: hotspotApi.overview });

  if (overview.isLoading) return <p className="text-slate-500">Chargement…</p>;
  const data = overview.data;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <div className="text-sm text-slate-500">Sessions en cours</div>
          <div className="mt-1 text-2xl font-semibold">{data.activeSessionCount}</div>
        </Card>
        <Card>
          <div className="text-sm text-slate-500">Cookies vivants</div>
          <div className="mt-1 text-2xl font-semibold">{data.cookieCount}</div>
        </Card>
        <Card>
          <div className="text-sm text-slate-500">Sessions entrées sans RADIUS</div>
          <div className="mt-1 text-2xl font-semibold text-amber-600">
            {data.sessionsWithoutRadius}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Une suspension côté User Manager ne les coupe pas : il faut effacer leur cookie.
          </p>
        </Card>
      </div>

      {data.servers.map((server) => (
        <Card key={server.id} title={`Serveur ${server.name}`}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
            <Field label="Interface" value={server.interfaceName} />
            <Field label="Pool d'adresses" value={server.addressPool} />
            <Field label="Profil" value={server.profileName} />
            <Field
              label="Inactivité tolérée"
              value={server.idleTimeoutSeconds ? formatDuration(server.idleTimeoutSeconds) : 'aucune'}
            />
          </div>

          {server.profile && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 text-sm font-medium text-slate-700">
                Profil {server.profile.name}
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
                <Field label="Domaine" value={server.profile.dnsName} />
                <Field label="Page captive" value={server.profile.htmlDirectory} />
                <Field
                  label="Durée de vie des cookies"
                  value={
                    server.profile.httpCookieLifetimeSeconds
                      ? formatDuration(server.profile.httpCookieLifetimeSeconds)
                      : 'aucune'
                  }
                />
                <div>
                  <div className="text-xs text-slate-500">RADIUS</div>
                  <div className="mt-0.5">
                    {server.profile.useRadius ? (
                      <Badge tone="green">activé</Badge>
                    ) : (
                      <Badge tone="slate">désactivé</Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <div className="text-xs text-slate-500">Moyens de connexion acceptés</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {server.profile.loginBy.map((method) => (
                    <Badge key={method} tone={method.includes('cookie') ? 'amber' : 'slate'}>
                      {method}
                    </Badge>
                  ))}
                </div>
                {server.profile.loginBy.some((m) => m.includes('cookie')) && (
                  <p className="mt-2 text-xs text-amber-700">
                    Le cookie est accepté : un client déjà venu se reconnecte sans que sa validité
                    soit vérifiée, jusqu'à expiration du cookie.
                  </p>
                )}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-slate-800">{value ?? '—'}</div>
    </div>
  );
}

// ==================== Walled Garden ====================

function WalledGardenTab() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [host, setHost] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const walledGarden = useQuery({ queryKey: ['walled-garden'], queryFn: hotspotApi.walledGarden });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['walled-garden'] });
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Erreur inconnue');

  const addHost = useMutation({
    mutationFn: hotspotApi.addHost,
    onSuccess: () => {
      setError(null);
      setHost('');
      refresh();
    },
    onError,
  });
  const addIp = useMutation({
    mutationFn: hotspotApi.addIp,
    onSuccess: () => {
      setError(null);
      setAddress('');
      refresh();
    },
    onError,
  });
  const removeHost = useMutation({ mutationFn: hotspotApi.removeHost, onSuccess: refresh, onError });
  const removeIp = useMutation({ mutationFn: hotspotApi.removeIp, onSuccess: refresh, onError });

  function submitHost(e: FormEvent) {
    e.preventDefault();
    if (!host.trim()) return setError('Indiquez un domaine');
    addHost.mutate({ dstHost: host.trim() });
  }

  function submitIp(e: FormEvent) {
    e.preventDefault();
    if (!address.trim()) return setError('Indiquez une adresse');
    addIp.mutate({ dstAddress: address.trim() });
  }

  const empty =
    (walledGarden.data?.hosts.length ?? 0) === 0 && (walledGarden.data?.ips.length ?? 0) === 0;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
        Ce qu'un client peut joindre <strong>avant</strong> de saisir son code. Sans entrée ici,
        une page de paiement hébergée hors du routeur est inatteignable par qui n'a pas encore
        d'accès.
        {empty && !walledGarden.isLoading && (
          <span className="mt-1 block font-medium">
            Votre liste est vide : aucun service extérieur n'est joignable avant connexion.
          </span>
        )}
      </div>

      {canWrite && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card title="Ouvrir un domaine">
            <form onSubmit={submitHost} className="flex items-end gap-3">
              <FormField label="Domaine (joker accepté)">
                <Input
                  value={host}
                  placeholder="*.mvola.mg"
                  onChange={(e) => setHost(e.target.value)}
                />
              </FormField>
              <Button type="submit" disabled={addHost.isPending}>
                Ouvrir
              </Button>
            </form>
          </Card>

          <Card title="Ouvrir une adresse">
            <form onSubmit={submitIp} className="flex items-end gap-3">
              <FormField label="Adresse ou réseau">
                <Input
                  value={address}
                  placeholder="192.168.88.10 ou 192.0.2.0/24"
                  onChange={(e) => setAddress(e.target.value)}
                />
              </FormField>
              <Button type="submit" disabled={addIp.isPending}>
                Ouvrir
              </Button>
            </form>
          </Card>
        </div>
      )}

      <Card title="Domaines ouverts">
        <Table head={['Domaine', 'Action', 'Port', 'Utilisations', '']}>
          {walledGarden.data?.hosts.map((entry) => (
            <tr key={entry.id}>
              <td className="px-3 py-2 font-mono">{entry.dstHost}</td>
              <td className="px-3 py-2">
                <Badge tone={entry.action === 'allow' ? 'green' : 'red'}>{entry.action}</Badge>
              </td>
              <td className="px-3 py-2 text-slate-500">{entry.dstPort ?? 'tous'}</td>
              <td className="px-3 py-2 text-slate-500">{entry.hits}</td>
              <td className="px-3 py-2 text-right">
                {canWrite && (
                  <Button variant="danger" onClick={() => removeHost.mutate(entry.id)}>
                    Retirer
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {walledGarden.data?.hosts.length === 0 && (
            <tr>
              <td className="px-3 py-4 text-slate-400" colSpan={5}>
                Aucun domaine ouvert.
              </td>
            </tr>
          )}
        </Table>
      </Card>

      <Card title="Adresses ouvertes">
        <Table head={['Adresse', 'Action', 'Protocole', 'Port', '']}>
          {walledGarden.data?.ips.map((entry) => (
            <tr key={entry.id}>
              <td className="px-3 py-2 font-mono">{entry.dstAddress}</td>
              <td className="px-3 py-2">
                <Badge tone={entry.action === 'accept' ? 'green' : 'red'}>{entry.action}</Badge>
              </td>
              <td className="px-3 py-2 text-slate-500">{entry.protocol ?? 'tous'}</td>
              <td className="px-3 py-2 text-slate-500">{entry.dstPort ?? 'tous'}</td>
              <td className="px-3 py-2 text-right">
                {canWrite && (
                  <Button variant="danger" onClick={() => removeIp.mutate(entry.id)}>
                    Retirer
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {walledGarden.data?.ips.length === 0 && (
            <tr>
              <td className="px-3 py-4 text-slate-400" colSpan={5}>
                Aucune adresse ouverte.
              </td>
            </tr>
          )}
        </Table>
      </Card>
    </div>
  );
}

// ==================== Cookies ====================

function CookiesTab() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const cookies = useQuery({ queryKey: ['hotspot-cookies'], queryFn: hotspotApi.cookies });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['hotspot-cookies'] });
    queryClient.invalidateQueries({ queryKey: ['hotspot-overview'] });
  };
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Erreur inconnue');

  const remove = useMutation({ mutationFn: hotspotApi.deleteCookie, onSuccess: refresh, onError });
  const cut = useMutation({ mutationFn: hotspotApi.cutAccess, onSuccess: refresh, onError });

  /** Un compte peut porter plusieurs cookies : un par appareil. */
  const byUser = new Map<string, number>();
  for (const cookie of cookies.data ?? []) {
    byUser.set(cookie.username, (byUser.get(cookie.username) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
        Un cookie laisse un client se reconnecter <strong>sans repasser par RADIUS</strong> : sa
        validité n'est alors pas vérifiée. Couper un accès pour de bon suppose d'effacer ses
        cookies, ce que fait « Couper l'accès ».
      </div>

      <Table head={['Compte', 'Appareil', 'Expire dans', 'Cookies du compte', '']}>
        {cookies.data?.map((cookie) => (
          <tr key={cookie.id}>
            <td className="px-3 py-2 font-medium">{cookie.username}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">{cookie.macAddress}</td>
            <td className="px-3 py-2">{formatUptime(cookie.expiresInSeconds)}</td>
            <td className="px-3 py-2 text-slate-500">{byUser.get(cookie.username)}</td>
            <td className="space-x-2 px-3 py-2 text-right">
              {canWrite && (
                <>
                  <Button variant="secondary" onClick={() => remove.mutate(cookie.id)}>
                    Effacer
                  </Button>
                  <Button variant="danger" onClick={() => cut.mutate(cookie.username)}>
                    Couper l'accès
                  </Button>
                </>
              )}
            </td>
          </tr>
        ))}
        {cookies.data?.length === 0 && (
          <tr>
            <td className="px-3 py-4 text-slate-400" colSpan={5}>
              Aucun cookie.
            </td>
          </tr>
        )}
      </Table>
    </div>
  );
}

// ==================== Sessions ====================

function SessionsTab() {
  const sessions = useQuery({ queryKey: ['hotspot-sessions'], queryFn: hotspotApi.sessions });

  if (sessions.isLoading) return <p className="text-slate-500">Chargement…</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Historique comptabilisé par RADIUS : la seule source qui dise ce qu'un compte a réellement
        consommé. Les connexions entrées par cookie n'y figurent pas.
      </p>

      <Table head={['Compte', 'Début', 'Durée', 'Reçu', 'Envoyé', 'Appareil', 'Fin']}>
        {sessions.data?.map((session) => (
          <tr key={session.id}>
            <td className="px-3 py-2 font-medium">{session.username}</td>
            <td className="px-3 py-2 text-slate-500">
              {session.startedAt ? new Date(session.startedAt).toLocaleString('fr-FR') : '—'}
            </td>
            <td className="px-3 py-2">{formatUptime(session.uptimeSeconds)}</td>
            <td className="px-3 py-2">{formatVolume(session.bytesIn)}</td>
            <td className="px-3 py-2">{formatVolume(session.bytesOut)}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">
              {session.callingStationId ?? '—'}
            </td>
            <td className="px-3 py-2">
              {session.active ? (
                <Badge tone="green">en cours</Badge>
              ) : (
                <Badge tone="slate">{session.terminateCause ?? 'terminée'}</Badge>
              )}
            </td>
          </tr>
        ))}
        {sessions.data?.length === 0 && (
          <tr>
            <td className="px-3 py-4 text-slate-400" colSpan={7}>
              Aucune session enregistrée.
            </td>
          </tr>
        )}
      </Table>
    </div>
  );
}
