import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { hotspotTabsApi, type HotspotUser } from '../api/mikrotik-tabs';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from './ListeDuRouteur';
import { Section } from './Section';
import { EmptyState, TableSkeleton } from './ui';

/**
 * Les tickets, lus **sur le routeur** et non en base.
 *
 * La console tient bien une table `user_cache`, mais rien ne l'écrit — on n'y
 * trouve que des suppressions. La remplir demande un travail de fond, et ce
 * n'est pas une raison pour priver l'exploitant de ces trois listes en
 * attendant.
 *
 * **Lu seulement quand on ouvre la section.** C'est ce que les sections
 * repliées permettent : leur contenu n'existe pas tant qu'on ne les déplie
 * pas, donc le tableau de bord ne dépend pas du routeur pour s'afficher. Sur
 * ce parc, six cent quarante-six comptes traversent un tunnel à 209 ms —
 * faire payer cela à l'écran d'accueil de tout le monde, pour une liste que
 * personne n'ouvre certains jours, serait le plus mauvais des échanges.
 *
 * Les trois sections partagent une seule lecture : React Query reconnaît la
 * même clé et n'appelle qu'une fois, même si les trois sont ouvertes.
 */

/** Ce que le routeur appelle un ticket épuisé : son temps est consommé. */
function épuisé(u: HotspotUser): boolean {
  return u.limitUptimeSeconds !== null && u.uptimeSeconds >= u.limitUptimeSeconds;
}

function useComptes() {
  const { currentId } = useRouterSelection();
  return useQuery({
    queryKey: ['hotspot-users', currentId],
    queryFn: () => hotspotTabsApi.users(currentId),
    enabled: Boolean(currentId),
    // Une minute : on regarde ces listes en travaillant, pas en temps réel,
    // et chaque lecture est six cent comptes à travers le tunnel.
    staleTime: 60_000,
    retry: false,
  });
}

/** « 2 h 30 » plutôt que « 9000 s » : personne ne compte en secondes. */
function durée(secondes: number): string {
  const h = Math.floor(secondes / 3600);
  const m = Math.round((secondes % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

/** Un compte, avec ce qui le désigne pour une personne. */
function Ligne({ u, détail }: { u: HotspotUser; détail?: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="font-mono text-xs text-slate-900">{u.username}</span>
        {/* Sur ce parc, le commentaire porte le nom de la personne. C'est la
            seule chose qui permette de reconnaître un ticket sans le lire. */}
        {u.comment && <span className="ml-2 text-sm text-slate-600">{u.comment}</span>}
      </span>
      {détail && <span className="shrink-0 text-xs tabular-nums text-slate-500">{détail}</span>}
    </li>
  );
}

function Contenu({
  requête,
  comptes,
  vide,
  détail,
}: {
  requête: ReturnType<typeof useComptes>;
  comptes: HotspotUser[];
  vide: string;
  détail?: (u: HotspotUser) => string;
}) {
  if (requête.isPending) return <TableSkeleton columns={2} rows={3} />;
  if (requête.isError) return <PanneDuRouteur requête={requête} />;
  if (comptes.length === 0) return <EmptyState title={vide} />;

  return (
    <>
      <ul className="divide-y divide-slate-100">
        {/* Vingt suffisent à l'accueil : la liste entière se lit dans
            l'écran des comptes, qui est fait pour ça. */}
        {comptes.slice(0, 20).map((u) => (
          <Ligne key={u.id} u={u} détail={détail?.(u)} />
        ))}
      </ul>
      {comptes.length > 20 && (
        <p className="mt-2 text-xs text-slate-500">
          {comptes.length - 20} de plus —{' '}
          <Link to="/hotspot/comptes" className="font-medium text-sky-700 hover:underline">
            tout voir
          </Link>
        </p>
      )}
    </>
  );
}

export function TicketsDuRouteur() {
  const requête = useComptes();
  const comptes = requête.data ?? [];

  const actifs = comptes.filter((u) => !u.disabled && !épuisé(u));
  const finis = comptes.filter(épuisé);
  // Ce que chacun a consommé, du plus gros au plus petit. La question qu'on
  // se pose devant une ligne saturée est « qui ? », et elle n'avait pas de
  // réponse dans cette console.
  const gourmands = [...comptes]
    .filter((u) => u.bytesIn + u.bytesOut > 0)
    .sort((a, b) => b.bytesIn + b.bytesOut - (a.bytesIn + a.bytesOut));

  return (
    <>
      <Section
        id="tdb.tickets-actifs"
        titre="Tickets actifs"
        compte={requête.isSuccess ? actifs.length : undefined}
        indice="ni désactivés, ni épuisés"
      >
        <Contenu
          requête={requête}
          comptes={actifs}
          vide="Aucun ticket actif sur ce routeur."
          détail={(u) =>
            u.limitUptimeSeconds
              ? `${durée(u.uptimeSeconds)} sur ${durée(u.limitUptimeSeconds)}`
              : durée(u.uptimeSeconds)
          }
        />
      </Section>

      <Section
        id="tdb.tickets-epuises"
        titre="Tickets épuisés"
        compte={requête.isSuccess ? finis.length : undefined}
        ton="alerte"
        indice="temps consommé atteint"
      >
        <Contenu
          requête={requête}
          comptes={finis}
          vide="Aucun ticket n’a atteint son plafond."
          détail={(u) => durée(u.uptimeSeconds)}
        />
      </Section>

      <Section
        id="tdb.donnees-par-compte"
        titre="Données par compte"
        compte={requête.isSuccess ? gourmands.length : undefined}
        indice="du plus gros consommateur"
      >
        <Contenu
          requête={requête}
          comptes={gourmands}
          vide="Aucune consommation relevée."
          détail={(u) => octets(u.bytesIn + u.bytesOut)}
        />
      </Section>
    </>
  );
}

/**
 * Des octets en unités lisibles.
 *
 * Base 1000 et non 1024 : c'est ce que disent les forfaits vendus à Toliara,
 * et un écart de 7 % entre l'écran et ce que le client a acheté se remarque.
 */
function octets(n: number): string {
  if (n < 1000) return `${n} o`;
  const unités = ['ko', 'Mo', 'Go', 'To'];
  let valeur = n / 1000;
  let rang = 0;
  while (valeur >= 1000 && rang < unités.length - 1) {
    valeur /= 1000;
    rang += 1;
  }
  return `${valeur.toFixed(valeur < 10 ? 1 : 0)} ${unités[rang]}`;
}
