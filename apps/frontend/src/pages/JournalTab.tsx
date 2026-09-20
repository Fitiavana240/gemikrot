import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { routerToolsApi, type RouterLogEntry } from '../api/router-tools';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, Table, TableSkeleton } from '../components/ui';

/**
 * Le journal du routeur tient dans sa mémoire vive, et il tourne vite.
 *
 * Mesuré sur le hAP : mille lignes couvraient **quatre heures et demie**, dont
 * 127 fois le même échec de poignée de main WireGuard. L'écran affichait les
 * 200 dernières — et dans cette fenêtre il n'y avait **aucun** des cinq
 * problèmes que le tampon contenait pourtant. C'est ce constat qui a dicté les
 * deux traitements ci-dessous : lire tout le tampon, et replier les répétitions.
 */
const TAILLE_TAMPON = 1000;

/** Combien de lignes on rend au maximum, une fois les répétitions repliées. */
const LIGNES_RENDUES = 250;

type Famille = { id: string; libellé: string; sujets: string[] };

/**
 * Les familles telles qu'un exploitant les cherche, pas telles que RouterOS
 * les nomme. Un même sujet peut appartenir à plusieurs lignes ; on regarde
 * l'intersection, pas l'égalité.
 */
const FAMILLES: Famille[] = [
  { id: 'hotspot', libellé: 'Clients du portail', sujets: ['hotspot', 'radius'] },
  { id: 'wireless', libellé: 'Wi-Fi', sujets: ['wireless'] },
  { id: 'dhcp', libellé: 'Adresses (DHCP)', sujets: ['dhcp'] },
  { id: 'wireguard', libellé: 'Tunnel', sujets: ['wireguard'] },
  { id: 'system', libellé: 'Système et connexions', sujets: ['system', 'account'] },
];

/** Une ligne, et le nombre de fois où le même fait s'est répété. */
type Groupe = {
  entrée: RouterLogEntry;
  répétitions: number;
  /** Heure de la plus ancienne occurrence, quand il y en a plusieurs. */
  depuis: string | null;
};

/**
 * La clé qui dit « c'est le même fait ».
 *
 * Les nombres et les adresses MAC varient d'une occurrence à l'autre sans
 * changer la nature de l'événement : un bail DHCP pour une machine puis une
 * autre, une tentative n° 2 puis n° 3. Les neutraliser regroupe ce qui doit
 * l'être. Les sujets entrent aussi dans la clé : deux messages identiques sur
 * des sujets différents ne sont pas le même fait.
 */
function clé(entrée: RouterLogEntry): string {
  const normalisé = entrée.message
    .replace(/[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}/g, '§')
    .replace(/\d+/g, '#');
  return `${entrée.topics.join(',')}|${normalisé}`;
}

/**
 * Replie les répétitions, **où qu'elles soient** dans le tampon.
 *
 * Le premier essai ne repliait que les lignes consécutives — et ne repliait
 * rien du tout sur ce routeur : le tunnel alterne « retrying » et « giving
 * up », si bien qu'aucune ligne n'est jamais identique à sa voisine. Mesuré :
 * 254 lignes de tunnel sur les 1000, réduites ici à deux.
 *
 * Le prix est l'ordre : les groupes sont classés par occurrence **la plus
 * récente**, pas strictement à la chronologie. C'est le bon compromis pour un
 * écran qui sert à trouver ce qui ne va pas, et le repliement se désactive
 * pour retrouver le fil exact.
 */
export function replier(entrées: RouterLogEntry[]): Groupe[] {
  const vus = new Map<string, Groupe>();
  const ordre: Groupe[] = [];
  for (const e of entrées) {
    const k = clé(e);
    const déjà = vus.get(k);
    if (déjà) {
      déjà.répétitions += 1;
      // Les entrées viennent du plus récent au plus ancien : la dernière vue
      // du groupe est donc la plus ancienne.
      déjà.depuis = e.time;
      continue;
    }
    const groupe: Groupe = { entrée: e, répétitions: 1, depuis: null };
    vus.set(k, groupe);
    ordre.push(groupe);
  }
  return ordre;
}

/** Sans repliement : chaque ligne est son propre groupe. */
function telQuel(entrées: RouterLogEntry[]): Groupe[] {
  return entrées.map((entrée) => ({ entrée, répétitions: 1, depuis: null }));
}

/**
 * Au-delà de cette longueur, un message n'est plus une phrase : c'est un
 * contenu de fichier recopié dans le journal.
 */
const MESSAGE_LONG = 300;

/**
 * Un message, tronqué quand il est démesuré.
 *
 * RouterOS journalise la commande **entière** d'un `/file add`, contenu
 * compris. Écrire une planche de tickets sur le routeur y verse donc quatre
 * kilo-octets d'ASCII85 en plusieurs lignes — mesuré sur ce parc. Sans cette
 * coupe, une seule de ces lignes étire le tableau au point de rendre tout
 * l'écran illisible.
 */
function Message({ texte }: { texte: string }) {
  const [déplié, setDéplié] = useState(false);
  if (texte.length <= MESSAGE_LONG) return <>{texte}</>;
  return (
    <>
      <span className={déplié ? 'break-all' : undefined}>
        {déplié ? texte : `${texte.slice(0, MESSAGE_LONG)}…`}
      </span>{' '}
      <button
        type="button"
        onClick={() => setDéplié((v) => !v)}
        className="whitespace-nowrap font-medium text-sky-700 hover:underline"
      >
        {déplié ? 'réduire' : `voir les ${texte.length} caractères`}
      </button>
    </>
  );
}

export function JournalTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-log', currentId],
    // Le routeur est lu en entier de toute façon : le serveur tronque après
    // coup. Demander tout le tampon ne coûte donc rien au routeur, et c'est
    // la seule manière de trouver un problème vieux de deux heures.
    queryFn: () => routerToolsApi.log(currentId!, TAILLE_TAMPON),
    enabled: Boolean(currentId),
    refetchInterval: 20_000,
  });

  const [filtre, setFiltre] = useState<string>('tout');
  // Replié par défaut : mesuré sur ce routeur, la vue brute est illisible.
  const [replié, setReplié] = useState(true);

  const toutes = useMemo(() => requête.data ?? [], [requête.data]);
  const problèmes = useMemo(() => toutes.filter((l) => l.isProblem), [toutes]);

  const comptes = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of FAMILLES) {
      m.set(f.id, toutes.filter((l) => l.topics.some((t) => f.sujets.includes(t))).length);
    }
    return m;
  }, [toutes]);

  const filtrées = useMemo(() => {
    if (filtre === 'tout') return toutes;
    if (filtre === 'problemes') return problèmes;
    const f = FAMILLES.find((x) => x.id === filtre);
    return f ? toutes.filter((l) => l.topics.some((t) => f.sujets.includes(t))) : toutes;
  }, [filtre, toutes, problèmes]);

  const tousGroupes = useMemo(
    () => (replié ? replier(filtrées) : telQuel(filtrées)),
    [filtrées, replié],
  );
  const groupes = tousGroupes.slice(0, LIGNES_RENDUES);

  if (requête.isError) return <PanneDuRouteur requête={requête} />;

  const étendue =
    toutes.length > 0 ? { du: toutes[toutes.length - 1].time, au: toutes[0].time } : null;

  const onglet = (id: string, libellé: string, n: number, alerte = false) => (
    <button
      key={id}
      type="button"
      onClick={() => setFiltre(id)}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        filtre === id
          ? alerte
            ? 'bg-red-600 text-white'
            : 'bg-slate-800 text-white'
          : alerte && n > 0
            ? 'bg-red-50 text-red-700 hover:bg-red-100'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {libellé} <span className="tabular-nums opacity-70">{n}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Ce que le routeur a noté, du plus récent au plus ancien, dans{' '}
        <strong>son</strong> fuseau horaire. C&apos;est ici qu&apos;on lit pourquoi un client a été
        déconnecté, ou pourquoi une authentification a échoué.
      </p>

      {/* Le tampon est en mémoire vive : il se vide au redémarrage et tourne
          d'autant plus vite que le routeur est bavard. Le dire avec l'étendue
          réellement mesurée vaut mieux qu'un avertissement générique. */}
      {étendue && (
        <p className="max-w-3xl text-xs text-slate-500">
          Le routeur ne garde que ses {TAILLE_TAMPON} dernières lignes, en mémoire vive — ici{' '}
          <span className="font-mono">{étendue.du}</span> à{' '}
          <span className="font-mono">{étendue.au}</span>. Au-delà, c&apos;est perdu, et un
          redémarrage efface tout.
        </p>
      )}

      {problèmes.length > 0 && filtre !== 'problemes' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>
            {problèmes.length} ligne(s) d&apos;erreur ou d&apos;avertissement dans ce tampon.
          </strong>{' '}
          Elles sont noyées dans le reste —{' '}
          <button
            type="button"
            onClick={() => setFiltre('problemes')}
            className="font-medium underline"
          >
            les afficher seules
          </button>
          .
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {onglet('tout', 'Tout', toutes.length)}
        {onglet('problemes', 'Problèmes', problèmes.length, true)}
        <span className="mx-1 h-4 w-px bg-slate-200" />
        {FAMILLES.map((f) => onglet(f.id, f.libellé, comptes.get(f.id) ?? 0))}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={replié}
            onChange={(e) => setReplié(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Replier les répétitions
        </label>
      </div>

      <Card>
        {requête.isPending ? (
          <TableSkeleton columns={3} />
        ) : groupes.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-slate-500">
            {filtre === 'problemes'
              ? 'Aucune erreur ni avertissement dans ce tampon.'
              : 'Rien à afficher pour ce filtre.'}
          </p>
        ) : (
          <Table head={['Quand', 'Sujets', 'Message']}>
            {groupes.map((g) => (
              <tr
                key={g.entrée.id}
                className={g.entrée.isProblem ? 'bg-red-50/40' : undefined}
              >
                <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs text-slate-500">
                  {g.entrée.time}
                  {g.depuis && (
                    <div className="mt-0.5 font-sans text-[11px] text-slate-400">
                      depuis {g.depuis.slice(11)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <span className="flex flex-wrap gap-1">
                    {g.entrée.topics.map((t) => (
                      <Badge key={t} tone={g.entrée.isProblem ? 'red' : 'slate'}>
                        {t}
                      </Badge>
                    ))}
                  </span>
                </td>
                <td className="max-w-xl px-3 py-2 align-top text-xs">
                  <Message texte={g.entrée.message} />
                  {g.répétitions > 1 && (
                    <span
                      className={`ml-2 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                        g.entrée.isProblem
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                      title="Lignes identiques qui se suivent, repliées en une seule"
                    >
                      ×{g.répétitions}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {tousGroupes.length > LIGNES_RENDUES && (
        <p className="text-xs text-slate-500">
          {LIGNES_RENDUES} lignes affichées sur {tousGroupes.length}. Affinez le filtre
          {!replié && ' ou repliez les répétitions'} pour voir le reste.
        </p>
      )}
    </div>
  );
}
