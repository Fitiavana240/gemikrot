import { useQuery } from '@tanstack/react-query';
import { routerToolsApi, type CompteRouteur } from '../api/router-tools';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, Table, TableSkeleton } from '../components/ui';

/** Au-delà, un compte qui garde ses droits sans servir est une porte oubliée. */
const INACTIF_JOURS = 30;

/**
 * Des JOURS DE CALENDRIER, et non des tranches de 24 heures.
 *
 * Le premier essai divisait l'écart en millisecondes : une connexion de la
 * veille à 11 h, lue le lendemain à 9 h, donnait 22 heures, donc zéro jour,
 * donc « aujourd'hui ». Faux et trompeur — c'était hier.
 *
 * RouterOS écrit « 2026-09-20 10:59:05 » sans fuseau : c'est l'heure du
 * routeur. On la lit comme locale, ce qui est juste tant que la console est
 * exploitée dans le même fuseau que lui — le cas ici, et le seul qui
 * change quelque chose à un jour près.
 */
function joursDepuis(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return null;
  const minuitAlors = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const maintenant = new Date();
  const minuitAujourdhui = new Date(
    maintenant.getFullYear(),
    maintenant.getMonth(),
    maintenant.getDate(),
  ).getTime();
  return Math.round((minuitAujourdhui - minuitAlors) / 86_400_000);
}

function ancienneté(compte: CompteRouteur): string {
  const j = joursDepuis(compte.lastLoggedIn);
  if (compte.lastLoggedIn === null) return 'jamais';
  if (j === null) return compte.lastLoggedIn;
  if (j <= 0) return "aujourd'hui";
  if (j === 1) return 'hier';
  return `il y a ${j} j`;
}

/**
 * Qui peut entrer dans le routeur, et par où.
 *
 * À ne pas confondre avec les comptes HotSpot, qui n'ouvrent qu'Internet :
 * ceux-ci ouvrent **le routeur**. C'est la surface la plus sensible du parc,
 * et elle n'était visible que depuis WinBox.
 */
export function AccesRouteurTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-acces', currentId],
    queryFn: () => routerToolsApi.acces(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 300_000,
  });

  if (requête.isError) return <PanneDuRouteur requête={requête} />;

  const comptes = requête.data?.comptes ?? [];
  const groupes = requête.data?.groupes ?? [];
  const exposition = requête.data?.exposition;
  const parGroupe = new Map(groupes.map((g) => [g.name, g]));

  // `controleTotal` et non « a des droits » : un compte de service DOIT
  // écrire, le signaler pour cela noierait le seul qui compte. Ce qui compte,
  // c'est `policy` — pouvoir se donner n'importe quel droit.
  const toutPuissant = (c: CompteRouteur): boolean =>
    parGroupe.get(c.group)?.controleTotal === true;
  const exposés = comptes.filter((c) => !c.disabled && !c.address && toutPuissant(c));
  const macPartout =
    exposition != null &&
    (exposition.macServerInterfaces === 'all' || exposition.macServerInterfaces === '');

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Les comptes qui ouvrent <strong>le routeur lui-même</strong> — rien à voir avec les
        comptes HotSpot, qui n&apos;ouvrent qu&apos;Internet. C&apos;est la surface la plus
        sensible du parc, et elle ne se lisait jusqu&apos;ici que dans WinBox.
      </p>

      {requête.isPending ? (
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      ) : (
        <>
          {macPartout && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <strong>WinBox par adresse MAC répond sur toutes les interfaces</strong>, y
              compris le pont de vos clients. Quelqu&apos;un connecté à votre Wi-Fi peut donc
              atteindre le routeur <strong>sans passer par une adresse IP</strong> — ni
              pare-feu, ni restriction d&apos;adresse ne s&apos;y appliquent. Le réglage tient
              en une liste d&apos;interfaces :{' '}
              <span className="font-mono text-xs">
                /tool mac-server set allowed-interface-list=none
              </span>{' '}
              le ferme entièrement, ou une liste ne contenant que le lien d&apos;administration.
            </div>
          )}

          {exposés.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>
                {exposés.length === 1
                  ? `Le compte ${exposés[0].name} peut tout faire, et accepte les connexions de n’importe où.`
                  : `${exposés.length} comptes peuvent tout faire et acceptent les connexions de n’importe où.`}
              </strong>{' '}
              {exposés.length === 1 ? 'Il porte' : 'Ils portent'} le droit{' '}
              <span className="font-mono text-xs">policy</span> :{' '}
              {exposés.length === 1 ? 'il peut' : 'ils peuvent'} créer des comptes et
              s&apos;accorder ce qu&apos;on {exposés.length === 1 ? 'lui' : 'leur'} a refusé.
              Restreindre {exposés.length === 1 ? 'son' : 'leur'} champ <em>address</em> à
              votre réseau de gestion réduit la surface sans rien changer à votre usage.
            </div>
          )}

          <Card title={`${comptes.length} compte(s) d’administration`}>
            <Table head={['Compte', 'Droits', 'Depuis', 'Dernière connexion', 'État']}>
              {comptes.map((c) => {
                const g = parGroupe.get(c.group);
                const j = joursDepuis(c.lastLoggedIn);
                const dormant = c.lastLoggedIn === null || (j !== null && j > INACTIF_JOURS);
                return (
                  <tr key={c.id} className={c.disabled ? 'opacity-60' : undefined}>
                    <td className="px-3 py-2 font-medium">
                      {c.name}
                      {c.comment && (
                        <span className="ml-1.5 text-xs text-slate-400">{c.comment}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={g?.controleTotal ? 'red' : g?.ecriture ? 'amber' : 'slate'}>
                        {c.group}
                      </Badge>
                      <span className="ml-1.5 text-xs text-slate-500">
                        {g?.controleTotal
                          ? 'peut tout faire'
                          : g?.ecriture
                            ? 'peut configurer'
                            : 'lecture seule'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {c.address ? (
                        <span className="font-mono text-xs">{c.address}</span>
                      ) : (
                        <Badge tone="amber">n’importe où</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <span className={dormant ? 'text-amber-800' : 'text-slate-600'}>
                        {ancienneté(c)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={c.disabled ? 'slate' : 'green'}>
                        {c.disabled ? 'désactivé' : 'actif'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </Table>
            {/* Un compte de service qui n'a pas servi depuis un mois est une
                porte qu'on a oublié de refermer, pas une commodité. */}
            <p className="mt-3 max-w-3xl text-xs text-slate-500">
              Un compte qui ne s&apos;est pas connecté depuis plus de {INACTIF_JOURS} jours
              apparaît en ambre : il garde pourtant tous ses droits.
            </p>
          </Card>

          <Card title="Groupes de droits">
            <Table head={['Groupe', 'Peut tout faire', 'Configurer', 'Secrets', 'Permissions']}>
              {groupes.map((g) => (
                <tr key={g.id}>
                  <td className="px-3 py-2 font-medium">{g.name}</td>
                  <td className="px-3 py-2">
                    <Badge tone={g.controleTotal ? 'red' : 'green'}>
                      {g.controleTotal ? 'oui' : 'non'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={g.ecriture ? 'amber' : 'slate'}>
                      {g.ecriture ? 'oui' : 'non'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={g.secrets ? 'amber' : 'slate'}>
                      {g.secrets ? 'oui' : 'non'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {g.policy.join(', ')}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>

          {exposition && (
            <Card title="Les autres portes">
              <p className="mb-3 max-w-3xl text-sm text-slate-600">
                Services qui ouvrent un accès en dehors de l&apos;API. Fermés, ils ne coûtent
                rien ; ouverts sans qu&apos;on le sache, ils contournent tout le reste.
              </p>
              <Table head={['Service', 'État', 'Ce que cela veut dire']}>
                <tr>
                  <td className="px-3 py-2 font-medium">WinBox par MAC</td>
                  <td className="px-3 py-2">
                    <Badge tone={macPartout ? 'red' : 'green'}>
                      {exposition.macServerInterfaces || 'aucune'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-600">
                    {macPartout
                      ? 'Joignable depuis toutes les interfaces, dont celle des clients.'
                      : 'Limité aux interfaces listées.'}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">Ping par MAC</td>
                  <td className="px-3 py-2">
                    <Badge tone={exposition.macPingEnabled ? 'amber' : 'green'}>
                      {exposition.macPingEnabled ? 'activé' : 'désactivé'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-600">
                    Permet de repérer le routeur sans adresse IP.
                  </td>
                </tr>
                {(
                  [
                    ['Proxy HTTP', exposition.proxyEnabled, 'Relaie du trafic au nom du routeur.'],
                    ['UPnP', exposition.upnpEnabled, 'Laisse un appareil ouvrir des ports tout seul.'],
                    ['SNMP', exposition.snmpEnabled, 'Expose l’état du routeur en lecture.'],
                  ] as const
                ).map(([nom, actif, quoi]) => (
                  <tr key={nom}>
                    <td className="px-3 py-2 font-medium">{nom}</td>
                    <td className="px-3 py-2">
                      <Badge tone={actif ? 'red' : 'green'}>
                        {actif ? 'activé' : 'désactivé'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-600">{quoi}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
