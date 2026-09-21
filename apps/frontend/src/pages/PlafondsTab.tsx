import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hotspotApi, type RapportPlafonds } from '../api/hotspot';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useRouterSelection } from '../routers/RouterContext';
import { Badge, Button, Card, Table } from '../components/ui';

/** `7200` → « 2 h ». Les plafonds de tickets se comptent en heures. */
function heures(secondes: number): string {
  const h = secondes / 3600;
  return Number.isInteger(h) ? `${h} h` : `${Math.round(secondes / 60)} min`;
}

/**
 * Les comptes vendables qu'aucun plafond de durée n'arrête.
 *
 * Sans `limit-uptime`, un ticket HotSpot ne finit jamais. Le `session-timeout`
 * du profil coupe la session en cours, mais **repart à zéro à chaque
 * reconnexion** — et le cookie rend cette reconnexion automatique. Un
 * « 2 heures » se rejoue donc indéfiniment.
 *
 * Deux temps, toujours : on regarde, puis on applique. Poser un plafond sur
 * des comptes en vente n'est pas un geste qu'on découvre après coup.
 */
export function PlafondsTab() {
  const { canWrite } = useAuth();
  const { currentId } = useRouterSelection();
  const queryClient = useQueryClient();
  const [rapport, setRapport] = useState<RapportPlafonds | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const lancer = useMutation({
    mutationFn: (appliquer: boolean) => hotspotApi.plafonds(currentId, appliquer),
    onSuccess: (r) => {
      setRapport(r);
      setErreur(null);
      if (r.appliqué) {
        queryClient.invalidateQueries({ queryKey: ['hotspot-users'] });
        queryClient.invalidateQueries({ queryKey: ['hotspot-stock'] });
      }
    },
    onError: (e: unknown) => setErreur(e instanceof ApiError ? e.message : 'Erreur inconnue'),
  });

  const aCorriger = rapport?.aCorriger ?? [];
  const parProfil = [...new Map(aCorriger.map((c) => [c.profil, c])).values()];

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Un ticket sans plafond de durée <strong>ne finit jamais</strong>. La durée du profil
        coupe la session en cours, mais elle repart à zéro à chaque reconnexion — et le cookie
        reconnecte tout seul. Ce contrôle pose sur chaque compte la durée de son offre, une
        bonne fois.
      </p>

      <Card title="Regarder d’abord">
        <p className="mb-3 max-w-3xl text-sm text-slate-600">
          La vérification ne touche à rien. Elle écarte d’office les abonnements au mois — qui
          se comptent en calendrier et non en heures de connexion —, les comptes déjà entamés
          et les comptes bloqués.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={lancer.isPending} onClick={() => lancer.mutate(false)}>
            {lancer.isPending ? 'Lecture…' : 'Voir ce qui manque'}
          </Button>
          {canWrite && aCorriger.length > 0 && !rapport?.appliqué && (
            <Button
              variant="secondary"
              disabled={lancer.isPending}
              onClick={() => lancer.mutate(true)}
            >
              Poser les {aCorriger.length} plafonds
            </Button>
          )}
        </div>

        {erreur && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {erreur}
          </p>
        )}
      </Card>

      {rapport && (
        <>
          {rapport.appliqué ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <strong>{rapport.corrigés} plafond(s) posé(s) sur le routeur.</strong>{' '}
              {rapport.échecs.length > 0 && (
                <>
                  {rapport.échecs.length} compte(s) en échec :{' '}
                  {rapport.échecs
                    .slice(0, 5)
                    .map((e) => e.username)
                    .join(', ')}
                  .
                </>
              )}
            </div>
          ) : aCorriger.length === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <strong>Tous les comptes vendables ont leur plafond.</strong> Rien à corriger.
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>
                {aCorriger.length} compte(s) vendable(s) sans plafond de durée.
              </strong>{' '}
              En l’état ils ne s’épuiseront jamais : le client reconnecte et repart pour la
              même durée, aussi souvent qu’il veut.
            </div>
          )}

          {parProfil.length > 0 && (
            <Card title="Ce qui serait posé">
              <Table head={['Offre', 'Comptes concernés', 'Plafond posé']}>
                {parProfil.map((p) => (
                  <tr key={p.profil}>
                    <td className="px-3 py-2 font-medium">{p.profil}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {aCorriger.filter((c) => c.profil === p.profil).length}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone="slate">{heures(p.plafondSecondes)}</Badge>
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {rapport.ignorés.length > 0 && (
            <Card title={`${rapport.ignorés.length} compte(s) laissé(s) de côté`}>
              {/* Montrés en entier : un compte épargné pour une mauvaise raison
                  est aussi grave qu'un compte corrigé à tort. */}
              <Table head={['Compte', 'Offre', 'Pourquoi']}>
                {rapport.ignorés.map((i) => (
                  <tr key={i.username}>
                    <td className="px-3 py-2 font-mono text-xs">{i.username}</td>
                    <td className="px-3 py-2 text-slate-600">{i.profil || '—'}</td>
                    <td className="px-3 py-2 text-sm text-slate-600">{i.motif}</td>
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
