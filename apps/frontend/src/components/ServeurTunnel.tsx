import { useQuery } from '@tanstack/react-query';
import { enrollmentsApi } from '../api/routers';
import { Card } from './ui';

/**
 * Est-ce que quelqu'un écoute en face ?
 *
 * Le script pose un pair sur le routeur, et le routeur se met à appeler. Si
 * rien n'écoute à l'adresse annoncée, **rien ne le dit** : WireGuard n'a pas
 * d'erreur, l'interface reste « active », les octets sortants montent et les
 * entrants restent à zéro. Constaté ici — le routeur appelait
 * `192.168.88.23:51820` depuis des heures, et personne n'écoutait.
 *
 * La consigne existait pourtant : le serveur écrivait dans son journal « pair
 * WireGuard à ajouter à la main ». Un avertissement de journal n'est pas une
 * information — c'est une information que personne ne lira.
 *
 * **Muet quand tout va bien.** Un panneau permanent devient du décor, et on
 * cesse de le lire la semaine où il compte.
 */
export function ServeurTunnel() {
  const requête = useQuery({
    queryKey: ['serveur-tunnel'],
    queryFn: enrollmentsApi.serveur,
    staleTime: 60_000,
    retry: false,
  });

  const d = requête.data;
  if (!d || d.manques.length === 0) return null;

  return (
    <Card title="Le tunnel ne peut pas s’établir en l’état">
      <p className="mb-3 text-sm text-slate-600">
        Les routeurs raccordés appellent <code className="rounded bg-slate-100 px-1">{d.endpoint}</code>.
        Tant que ce qui suit n&apos;est pas réglé, ils appelleront dans le vide —{' '}
        <strong>sans aucun message d&apos;erreur</strong>, ni sur le routeur ni ici.
      </p>

      <ul className="space-y-2 text-sm">
        {d.manques.map((m) => (
          <li key={m} className="flex gap-2 text-amber-900">
            <span aria-hidden className="shrink-0">
              ⚠
            </span>
            <span>{m}</span>
          </li>
        ))}
      </ul>

      {!d.pilote && d.pairs.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-slate-700">
            À passer sur le serveur, une fois par routeur :
          </p>
          <ul className="mt-2 space-y-2">
            {d.pairs.map((p) => (
              <li key={p.commande}>
                <p className="text-xs text-slate-500">{p.label}</p>
                <code className="mt-0.5 block break-all rounded bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100">
                  {p.commande}
                </code>
              </li>
            ))}
          </ul>
          {/* Sans la sauvegarde, le pair disparaît au redémarrage de
              l'interface et le routeur redevient injoignable sans que rien
              ne l'explique — la même panne, six mois plus tard. */}
          <p className="mt-2 text-xs text-slate-500">
            Puis <code>wg-quick save {d.interfaceName}</code> : sans
            sauvegarde, le pair disparaît au redémarrage de l&apos;interface et le routeur redevient
            injoignable.
          </p>
        </div>
      )}

      <p className="mt-4 border-t border-slate-200 pt-3 text-sm text-slate-600">
        <strong>Rien de tout cela ne coupe vos clients.</strong> Le portail captif et les forfaits
        tournent seuls sur le routeur. Ce qui manque, c&apos;est la possibilité de le piloter
        depuis ailleurs que son propre réseau.
      </p>
    </Card>
  );
}
