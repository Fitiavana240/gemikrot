import { useQuery } from '@tanstack/react-query';
import { hotspotTabsApi, type IpBinding } from '../api/mikrotik-tabs';
import { devicesApi, type Device } from '../api/devices';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, Table, TableSkeleton } from '../components/ui';

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

export function AccesPermanentsTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['ip-bindings', currentId],
    queryFn: () => hotspotTabsApi.ipBindings(currentId),
    enabled: Boolean(currentId),
    refetchInterval: 60_000,
  });
  const appareils = useQuery({ queryKey: ['devices'], queryFn: devicesApi.list });

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
              <Table head={['Appareil', 'Ce qui le décrit', 'Suivi par la console', 'Serveur']}>
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
                    <td className="px-3 py-2">
                      {appareil?.subscriptionId ? (
                        <Badge tone="green">abonnement suivi</Badge>
                      ) : appareil ? (
                        <Badge tone="amber">appareil connu, sans abonnement</Badge>
                      ) : (
                        <Badge tone="amber">inconnu de la console</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{binding.server ?? '—'}</td>
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
