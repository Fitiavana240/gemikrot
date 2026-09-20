import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { routerToolsApi, type ScriptDuRouteur, type TachePlanifiee } from '../api/router-tools';
import { formatDuree } from '../api/mikrotik-tabs';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, Table } from '../components/ui';

/**
 * Les autorisations qui donnent la main sur le routeur.
 *
 * Un script porte sa propre `policy`, et c'est elle qui s'applique — pas celle
 * du compte qui le lance. Ces quatre-là, réunies, équivalent à un accès
 * d'administration complet : modifier la configuration, lire et changer les
 * mots de passe, et gérer les comptes.
 */
const POLITIQUES_FORTES = new Set(['write', 'password', 'sensitive', 'policy']);

function politiquesFortes(policy: string[]): string[] {
  return policy.filter((p) => POLITIQUES_FORTES.has(p));
}

function PucePolitique({ nom }: { nom: string }) {
  return (
    <Badge tone={POLITIQUES_FORTES.has(nom) ? 'amber' : 'slate'}>{nom}</Badge>
  );
}

/**
 * Un script, avec son code replié.
 *
 * Le code est la seule chose qui dise vraiment ce que fait un script — un nom
 * ne suffit pas. Il est replié parce qu'il est long, et dépliable parce que
 * personne ne devrait ouvrir WinBox pour lire ce qui tourne sur son routeur.
 */
function LigneScript({ script, planifie }: { script: ScriptDuRouteur; planifie: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  const fortes = politiquesFortes(script.policy);

  return (
    <div className="rounded-lg border border-slate-200 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{script.name}</span>
        <span className="text-slate-500">
          créé par <span className="font-mono text-xs">{script.owner}</span>
        </span>
        <Badge tone={script.runCount > 0 ? 'green' : 'slate'}>
          {script.runCount > 0 ? `exécuté ${script.runCount} fois` : 'jamais exécuté'}
        </Badge>
        {planifie ? (
          <Badge tone="amber">appelé par l’ordonnanceur</Badge>
        ) : (
          <Badge tone="slate">lancé à la main seulement</Badge>
        )}
        {script.invalide && <Badge tone="red">invalide</Badge>}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-slate-500">autorisations :</span>
        {script.policy.length === 0 ? (
          <span className="text-xs text-slate-400">aucune</span>
        ) : (
          script.policy.map((p) => <PucePolitique key={p} nom={p} />)
        )}
      </div>

      {/* `dont-require-permissions` inverse la règle : le script s'exécute avec
          les droits de celui qui le lance. C'est le réglage le plus sûr des
          deux, et il change entièrement la lecture de la ligne au-dessus. */}
      {fortes.length > 0 && !script.dontRequirePermissions && (
        <p className="mt-2 text-sm text-amber-800">
          Ce script s&apos;exécute avec <strong>ses propres autorisations</strong> (
          {fortes.join(', ')}), quelles que soient celles de la personne qui le lance. Qui peut
          le déclencher peut donc en faire autant que son créateur.
        </p>
      )}
      {script.dontRequirePermissions && (
        <p className="mt-2 text-sm text-slate-600">
          Ce script emprunte les droits de celui qui le lance, pas les siens.
        </p>
      )}

      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        className="mt-2 text-xs font-medium text-sky-700 hover:underline"
      >
        {ouvert ? 'Masquer le code' : 'Voir le code'}
      </button>
      {ouvert && (
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-900 px-3 py-2.5 font-mono text-xs leading-relaxed text-slate-100">
          {script.source || '(vide)'}
        </pre>
      )}
    </div>
  );
}

function cadence(tache: TachePlanifiee): string {
  if (tache.intervalSeconds) return `toutes les ${formatDuree(tache.intervalSeconds)}`;
  if (tache.startTime === 'startup') return 'à chaque démarrage du routeur';
  return 'une seule fois';
}

/**
 * Ce qui peut tourner sans personne.
 *
 * Les deux menus sont présentés ensemble parce qu'aucun ne se lit seul : un
 * script sans entrée d'ordonnanceur ne s'exécute jamais de lui-même, et une
 * entrée d'ordonnanceur ne veut rien dire sans savoir ce qu'elle lance.
 */
export function AutomatisationsTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-automatisations', currentId],
    queryFn: () => routerToolsApi.automatisations(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 60_000,
  });

  if (requête.isError) return <PanneDuRouteur requête={requête} />;

  const scripts = requête.data?.scripts ?? [];
  const taches = requête.data?.taches ?? [];
  const actives = taches.filter((t) => !t.disabled);
  // Un script n'est « automatique » que si une tâche active le nomme. Chercher
  // le nom dans `on-event` couvre les deux formes : l'appel direct et le code
  // en ligne qui contient `/system script run <nom>`.
  const nommeParTache = (nom: string) =>
    actives.some((t) => t.onEvent === nom || t.onEvent.includes(nom));

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Ce que le routeur peut exécuter <strong>sans personne devant lui</strong>. Un script
        n&apos;est dangereux que s&apos;il peut être déclenché ; c&apos;est l&apos;ordonnanceur
        qui le déclenche tout seul.
      </p>

      {requête.isSuccess && actives.length === 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <strong>Rien ne tourne tout seul sur ce routeur.</strong> L&apos;ordonnanceur est vide :
          aucune tâche ne se déclenche à heure fixe ni au démarrage.
          {scripts.length > 0 && (
            <>
              {' '}
              {scripts.length === 1 ? 'Le script ci-dessous ne part' : 'Les scripts ci-dessous ne partent'}{' '}
              que si on {scripts.length === 1 ? 'le' : 'les'} lance à la main.
            </>
          )}
        </div>
      )}

      <Card title={`Ordonnanceur — ${taches.length} tâche(s)`}>
        {taches.length === 0 ? (
          <p className="text-sm text-slate-600">
            Aucune tâche planifiée. Les expirations de forfaits sont appliquées par le HotSpot
            lui-même, pas par l&apos;ordonnanceur — ce vide n&apos;est donc pas une panne.
          </p>
        ) : (
          <Table head={['Tâche', 'Lance', 'Cadence', 'Prochaine', 'Exécutions', 'État']}>
            {taches.map((t) => (
              <tr key={t.id} className={t.disabled ? 'opacity-60' : undefined}>
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="max-w-[20rem] truncate px-3 py-2 font-mono text-xs text-slate-500">
                  {t.onEvent}
                </td>
                <td className="px-3 py-2 text-slate-600">{cadence(t)}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{t.nextRun ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums text-slate-500">{t.runCount}</td>
                <td className="px-3 py-2">
                  <Badge tone={t.disabled ? 'slate' : 'green'}>
                    {t.disabled ? 'désactivée' : 'active'}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title={`Scripts — ${scripts.length}`}>
        {scripts.length === 0 ? (
          <p className="text-sm text-slate-600">Aucun script enregistré sur ce routeur.</p>
        ) : (
          <div className="space-y-3">
            {scripts.map((s) => (
              <LigneScript key={s.id} script={s} planifie={nommeParTache(s.name)} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
