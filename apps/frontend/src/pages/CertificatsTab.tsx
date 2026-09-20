import { useQuery } from '@tanstack/react-query';
import { routerToolsApi, type Certificat } from '../api/router-tools';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, Table, TableSkeleton } from '../components/ui';

/** Au-delà d'un mois, on n'alerte pas ; en deçà, il faut s'en occuper. */
const BIENTOT = 30 * 24 * 3600;

function échéance(c: Certificat): { ton: 'green' | 'amber' | 'red'; texte: string } {
  if (c.expiresInSeconds == null) return { ton: 'amber', texte: 'échéance inconnue' };
  if (c.expiresInSeconds <= 0) return { ton: 'red', texte: 'expiré' };
  const jours = Math.round(c.expiresInSeconds / 86_400);
  if (c.expiresInSeconds < BIENTOT) return { ton: 'amber', texte: `expire dans ${jours} j` };
  if (jours > 365) {
    return { ton: 'green', texte: `encore ${Math.round(jours / 365.25)} ans` };
  }
  return { ton: 'green', texte: `encore ${jours} j` };
}

/**
 * Les noms qu'un certificat couvre.
 *
 * Un certificat ne vaut que pour les noms qu'il déclare. Le `common-name`
 * seul ne suffit plus depuis longtemps : les bibliothèques TLS modernes
 * exigent un `subject-alt-name`, et son absence suffit à faire rejeter un
 * certificat par ailleurs valide.
 */
function nomsCouverts(c: Certificat): string[] {
  return c.subjectAltNames.length > 0 ? c.subjectAltNames : c.commonName ? [c.commonName] : [];
}

export function CertificatsTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-certificates', currentId],
    queryFn: () => routerToolsApi.certificats(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 300_000,
  });
  const tunnel = useQuery({
    queryKey: ['tools-wireguard', currentId],
    queryFn: () => routerToolsApi.wireguard(currentId!),
    enabled: Boolean(currentId),
  });

  if (requête.isError) return <PanneDuRouteur requête={requête} />;

  const certificats = requête.data ?? [];
  // Seuls ceux qui ont leur clé privée peuvent servir le service REST : les
  // autres sont des autorités importées, sans effet sur cette connexion.
  const serveurs = certificats.filter((c) => c.hasPrivateKey);
  const sansSan = serveurs.filter((c) => c.subjectAltNames.length === 0);
  const adresse = tunnel.data?.chemin?.adresse;
  // Le cas qui piège : le certificat nomme l'adresse locale, la console passe
  // par le tunnel, et le nom ne correspond donc à rien de ce qu'elle appelle.
  const adresseNonCouverte =
    adresse != null && serveurs.length > 0 && !serveurs.some((c) => nomsCouverts(c).includes(adresse));

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Le certificat que présente le routeur quand la console lui parle. C&apos;est lui qui
        permet — ou non — de <strong>vérifier qu&apos;on parle bien au bon routeur</strong> et
        pas à quelqu&apos;un qui s&apos;est intercalé.
      </p>

      {sansSan.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>
            {sansSan.length === 1
              ? `Le certificat « ${sansSan[0].name} » ne déclare aucun nom alternatif.`
              : `${sansSan.length} certificats ne déclarent aucun nom alternatif.`}
          </strong>{' '}
          Les bibliothèques TLS d&apos;aujourd&apos;hui refusent un certificat qui n&apos;a
          qu&apos;un <span className="font-mono text-xs">common-name</span> : c&apos;est pour
          cela que la vérification est désactivée côté console. Tant qu&apos;elle l&apos;est,
          personne ne contrôle à qui l&apos;on parle.
        </div>
      )}

      {adresseNonCouverte && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>
            La console joint ce routeur à l&apos;adresse{' '}
            <span className="font-mono">{adresse}</span>, qu&apos;aucun certificat ne couvre.
          </strong>{' '}
          Même en réactivant la vérification, elle échouerait sur le nom. Un certificat
          refait devra nommer cette adresse-là — celle par laquelle on l&apos;appelle, pas
          celle qu&apos;il porte sur son réseau.
        </div>
      )}

      {requête.isPending ? (
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      ) : certificats.length === 0 ? (
        <Card title="Aucun certificat">
          <p className="text-sm text-slate-600">
            Ce routeur ne porte aucun certificat. Le service REST est donc servi en clair, ou
            avec un certificat engendré à la volée qui change à chaque redémarrage.
          </p>
        </Card>
      ) : (
        <Card title={`${certificats.length} certificat(s)`}>
          <Table head={['Nom', 'Couvre', 'Origine', 'Clé', 'Validité']}>
            {certificats.map((c) => {
              const é = échéance(c);
              const noms = nomsCouverts(c);
              return (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs">{noms.join(', ') || '—'}</span>
                    {c.subjectAltNames.length === 0 && (
                      <span className="ml-1.5 text-xs text-amber-700">
                        (sans nom alternatif)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={c.selfSigned ? 'amber' : 'green'}>
                      {c.selfSigned ? 'auto-signé' : 'signé par un tiers'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {c.keyType.toUpperCase()}
                    {c.keySizeBits ? ` ${c.keySizeBits}` : ''}
                    {!c.hasPrivateKey && (
                      <span className="ml-1.5 text-slate-400">— sans clé privée</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={é.ton}>{é.texte}</Badge>
                    {c.invalidAfter && (
                      <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                        {c.invalidAfter.slice(0, 10)}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {/* L'empreinte est la seule chose qui identifie un certificat auto-signé
          de façon sûre. La montrer ici évite d'ouvrir WinBox le jour où l'on
          voudra épingler — et permet de constater qu'elle n'a pas changé,
          ce qui est exactement ce qu'un épinglage vérifie. */}
      {serveurs.length > 0 && (
        <Card title="Empreintes">
          <p className="mb-3 max-w-3xl text-sm text-slate-600">
            Pour un certificat auto-signé, l&apos;empreinte remplace la confiance :
            c&apos;est en la comparant qu&apos;on sait qu&apos;on parle au même routeur
            qu&apos;hier. <strong>Si elle change sans que vous ayez refait le certificat,
            quelque chose s&apos;est intercalé.</strong>
          </p>
          <div className="space-y-2">
            {serveurs.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-xs font-medium text-slate-600">{c.name}</p>
                <p className="mt-0.5 break-all font-mono text-xs text-slate-500">
                  {c.fingerprint || '—'}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
