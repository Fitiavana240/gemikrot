import { useQuery } from '@tanstack/react-query';
import { umTabsApi, type UmProfileLimitation } from '../api/mikrotik-tabs';
import { useRouterSelection } from '../routers/RouterContext';
import { ListeDuRouteur } from '../components/ListeDuRouteur';
import { Badge } from '../components/ui';

/** Les sept jours : autant dire aucune restriction de jour. */
const TOUS_LES_JOURS = 7;

const JOUR_COURT: Record<string, string> = {
  monday: 'lun',
  tuesday: 'mar',
  wednesday: 'mer',
  thursday: 'jeu',
  friday: 'ven',
  saturday: 'sam',
  sunday: 'dim',
};

/** `0` → `00:00`, `86399` → `23:59`. */
function heure(secondes: number | null): string {
  if (secondes == null) return '—';
  const h = Math.floor(secondes / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Une plage qui couvre la journée entière n'en est pas une.
 *
 * RouterOS écrit `0s` → `23h59m59s` par défaut, ce qui veut dire « toujours ».
 * L'afficher comme « 00:00 – 23:59 » ferait croire à une règle horaire là où
 * il n'y en a pas, et noierait celles qui en portent vraiment une.
 */
function toujours(l: UmProfileLimitation): boolean {
  return (l.fromTimeSeconds ?? 0) === 0 && (l.tillTimeSeconds ?? 0) >= 86_399;
}

/**
 * Quelles limitations s'appliquent à quel profil, et sous quelles conditions.
 *
 * L'onglet « Profile Limitations » de WinBox. Les jonctions étaient déjà lues
 * — l'écran Profils en tire la liste des limitations — mais réduites à des
 * noms : les heures et les jours étaient perdus en route. Or c'est eux qui
 * font la différence entre « ce forfait est bridé » et « ce forfait est bridé
 * le soir ».
 */
export function ProfileLimitationsTab() {
  const { currentId } = useRouterSelection();
  const requête = useQuery({
    queryKey: ['um-profile-limitations', currentId],
    queryFn: () => umTabsApi.profileLimitations(currentId),
  });

  const conditionnelles = (requête.data ?? []).filter(
    (l) => !toujours(l) || l.weekdays.length < TOUS_LES_JOURS,
  );

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-slate-600">
        Quelle limitation s&apos;applique à quel forfait — et <strong>quand</strong>. Une même
        limitation peut n&apos;être active qu&apos;à certaines heures ou certains jours : c&apos;est
        de quoi brider aux heures de pointe sans toucher au reste de la journée.
      </p>

      {conditionnelles.length > 0 && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <strong>
            {conditionnelles.length} limitation(s) ne s&apos;appliquent pas en permanence.
          </strong>{' '}
          En dehors de leur plage, le forfait n&apos;est pas bridé du tout — ce qui explique
          qu&apos;un client trouve le réseau rapide à une heure et lent à une autre.
        </p>
      )}

      <ListeDuRouteur
        requête={requête}
        colonnes={['Forfait', 'Limitation', 'Heures', 'Jours']}
        vide={{
          titre: 'Aucune limitation rattachée',
          aide: 'Les forfaits ne sont bridés par rien : le débit est celui du lien.',
        }}
        ligne={(l) => (
          <tr key={l.id}>
            <td className="px-3 py-2 font-medium">{l.profileName}</td>
            <td className="px-3 py-2">{l.limitationName}</td>
            <td className="px-3 py-2">
              {toujours(l) ? (
                <span className="text-sm text-slate-500">toute la journée</span>
              ) : (
                <Badge tone="amber">
                  {heure(l.fromTimeSeconds)} – {heure(l.tillTimeSeconds)}
                </Badge>
              )}
            </td>
            <td className="px-3 py-2 text-sm">
              {l.weekdays.length >= TOUS_LES_JOURS ? (
                <span className="text-slate-500">tous</span>
              ) : (
                <span className="text-amber-800">
                  {l.weekdays.map((j) => JOUR_COURT[j] ?? j).join(', ') || '—'}
                </span>
              )}
            </td>
          </tr>
        )}
      />
    </div>
  );
}
