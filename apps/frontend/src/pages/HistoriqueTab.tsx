import { useQuery } from '@tanstack/react-query';
import { routerToolsApi, type ChangementRouteur } from '../api/router-tools';
import { useRouterSelection } from '../routers/RouterContext';
import { PanneDuRouteur } from '../components/ListeDuRouteur';
import { Badge, Card, Table, TableSkeleton } from '../components/ui';

/**
 * Le routeur ne garde que cent changements.
 *
 * Ce n'est pas un détail : une rafale d'écritures efface tout ce qui la
 * précède. Constaté de la mauvaise façon sur ce parc — 221 écritures
 * successives ont vidé l'historique entier, y compris les modifications
 * faites depuis WinBox les jours précédents.
 */
const TAILLE_TAMPON = 100;

/**
 * Regroupe une rafale : même auteur, même forme d'action.
 *
 * Cent lignes « hotspot user H… changed » sont **un** fait, pas cent. Sans ce
 * repliement, l'écran ne montre qu'une rafale et rien d'autre — ce qui est
 * exactement ce qu'on cherche à éviter en le consultant.
 */
type Rafale = {
  premier: ChangementRouteur;
  dernier: ChangementRouteur;
  nombre: number;
};

export function replierRafales(changements: ChangementRouteur[]): Rafale[] {
  const rafales: Rafale[] = [];
  // Les nombres et identifiants varient d'une ligne à l'autre sans changer la
  // nature du geste : « user H872973 changed » et « user H869384 changed »
  // sont le même geste répété.
  const forme = (c: ChangementRouteur) =>
    `${c.par}|${c.action.replace(/[0-9A-Fa-f*]{2,}/g, '#')}`;

  for (const c of changements) {
    const dernière = rafales[rafales.length - 1];
    if (dernière && forme(dernière.premier) === forme(c)) {
      dernière.nombre += 1;
      dernière.dernier = c;
      continue;
    }
    rafales.push({ premier: c, dernier: c, nombre: 1 });
  }
  return rafales;
}

/**
 * Ce qui a été changé sur le routeur, et par qui.
 *
 * Le seul relevé qui voie **tout**, WinBox compris : le journal d'audit de la
 * console ne connaît que ce qui passe par elle. C'est ici qu'on voit qu'un
 * compte a été bloqué à la main, ou qu'une rafale d'écritures est partie.
 */
export function HistoriqueTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['tools-historique', currentId],
    queryFn: () => routerToolsApi.historique(currentId!),
    enabled: Boolean(currentId),
    refetchInterval: 60_000,
  });

  if (requête.isError) return <PanneDuRouteur requête={requête} />;

  const changements = requête.data ?? [];
  const rafales = replierRafales(changements);
  const plusGrosse = rafales.reduce<Rafale | null>(
    (max, r) => (max === null || r.nombre > max.nombre ? r : max),
    null,
  );
  const tamponSature = changements.length >= TAILLE_TAMPON;

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Ce que le routeur a vu changer dans sa configuration, <strong>quelle qu&apos;en soit
        l&apos;origine</strong> — cette console, WinBox, ou le terminal. Le journal des
        Réglages, lui, ne connaît que ce qui passe par ici.
      </p>

      {requête.isPending ? (
        <Card>
          <TableSkeleton columns={4} />
        </Card>
      ) : (
        <>
          {tamponSature && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>
                Le routeur ne garde que ses {TAILLE_TAMPON} derniers changements, et le tampon
                est plein.
              </strong>{' '}
              Tout ce qui précède est perdu — définitivement.{' '}
              {plusGrosse && plusGrosse.nombre >= TAILLE_TAMPON / 2 && (
                <>
                  Une seule rafale en occupe {plusGrosse.nombre} :{' '}
                  <strong>elle a chassé l&apos;historique qui la précédait.</strong>
                </>
              )}
            </div>
          )}

          <Card title={`${rafales.length} geste(s) sur ${changements.length} ligne(s)`}>
            <Table head={['Quand', 'Qui', 'Ce qui a changé', 'Annulable']}>
              {rafales.map((r) => (
                <tr key={r.premier.id}>
                  <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs text-slate-500">
                    {r.premier.time}
                    {r.nombre > 1 && (
                      <div className="mt-0.5 font-sans text-[11px] text-slate-400">
                        jusqu&apos;à {r.dernier.time.slice(11)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="font-medium">{r.premier.par}</span>
                    {r.premier.origine && (
                      <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                        {/* L'origine dit par où c'est entré : api, winbox, cli.
                            C'est elle qui distingue « la console » de « quelqu'un
                            devant WinBox ». */}
                        {r.premier.origine.split('/')[0]}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-sm">
                    {r.premier.action}
                    {r.nombre > 1 && (
                      <span className="ml-2 whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                        ×{r.nombre}
                      </span>
                    )}
                    {r.premier.commande && (
                      <div className="mt-1 break-all font-mono text-[11px] text-slate-500">
                        {r.premier.commande}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {/* Le drapeau du routeur ne suffit pas : il peut dire
                        « annulable » alors qu'aucune commande d'annulation
                        n'est enregistrée, auquel cas annuler ne restaure rien
                        de la valeur précédente. Relevé sur ce parc. */}
                    {r.premier.annulable && r.premier.commandeAnnulation ? (
                      <Badge tone="green">oui</Badge>
                    ) : r.premier.annulable ? (
                      <Badge tone="amber">sans valeur d’avant</Badge>
                    ) : (
                      <Badge tone="slate">non</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 max-w-3xl text-xs text-slate-500">
              « Sans valeur d&apos;avant » veut dire que le routeur accepte de défaire le
              geste mais n&apos;a pas noté ce qu&apos;il y avait auparavant : annuler ne
              restaurerait pas l&apos;ancien réglage.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
