import { useState } from 'react';
import type { CreateLimitationInput, UserManagerLimitation } from '../api/user-manager';
import { ChampDuree } from './Edition';
import { Button, Card, FormField, Input } from './ui';

/** Go saisis → octets, ou `null`. Vide veut dire « aucun plafond », pas zéro. */
export function octetsDepuisGo(valeur: string): number | null {
  const nombre = Number(valeur.replace(',', '.'));
  if (!valeur.trim() || !Number.isFinite(nombre) || nombre <= 0) return null;
  return Math.round(nombre * 1_073_741_824);
}

/** Octets → Go pour la saisie, sans traîner de décimales inutiles. */
export function goDepuisOctets(octets: number | null | undefined): string {
  if (!octets) return '';
  return String(Math.round((octets / 1_073_741_824) * 100) / 100);
}

function mbpsDepuisBits(bits: number | null | undefined): string {
  if (!bits) return '';
  return String(Math.round((bits / 1_000_000) * 100) / 100);
}

function bitsDepuisMbps(valeur: string): number | null {
  const nombre = Number(valeur.replace(',', '.'));
  if (!valeur.trim() || !Number.isFinite(nombre) || nombre <= 0) return null;
  return Math.round(nombre * 1_000_000);
}

/**
 * Le formulaire d'une limitation, en création comme en modification.
 *
 * **Un seul, pour les deux.** Ils étaient deux et avaient divergé : la
 * création proposait quatre champs, et la modification **un seul** — le débit
 * descendant. Changer le volume d'un forfait obligeait donc à passer par
 * WinBox, ce que cette console existe précisément pour éviter.
 *
 * Le nom n'est saisissable qu'à la création : sur RouterOS il **est**
 * l'identifiant, et le changer abandonnerait les profils qui le désignent.
 */
export function FormulaireLimitation({
  limitation,
  enCours,
  onValider,
  onAnnuler,
}: {
  limitation?: UserManagerLimitation;
  enCours: boolean;
  onValider: (valeurs: CreateLimitationInput) => void;
  onAnnuler?: () => void;
}) {
  const modification = limitation != null;
  const [nom, setNom] = useState(limitation?.name ?? '');
  const [descendant, setDescendant] = useState(
    mbpsDepuisBits(limitation?.rateLimit.rxBitsPerSecond),
  );
  const [montant, setMontant] = useState(mbpsDepuisBits(limitation?.rateLimit.txBitsPerSecond));
  const [total, setTotal] = useState(goDepuisOctets(limitation?.transferLimitBytes));
  const [reçu, setReçu] = useState(goDepuisOctets(limitation?.downloadLimitBytes));
  const [envoyé, setEnvoyé] = useState(goDepuisOctets(limitation?.uploadLimitBytes));
  const [durée, setDurée] = useState<number | null>(limitation?.uptimeLimitSeconds ?? null);
  const [période, setPériode] = useState<number | null>(
    limitation?.resetCountersIntervalSeconds ?? null,
  );
  const [départ, setDépart] = useState(limitation?.resetCountersStartTime?.slice(0, 10) ?? '');

  return (
    <Card title={modification ? `Modifier « ${limitation.name} »` : 'Créer une limitation'}>
      {modification && (
        <p className="mb-3 max-w-3xl text-sm text-amber-800">
          Ceci <strong>s&apos;applique à tous</strong> les abonnés qui utilisent cette limitation,
          dès leur prochaine connexion — y compris ceux dont le ticket est déjà vendu.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {!modification && (
          <FormField label="Nom">
            <Input value={nom} placeholder="BRIDAGE-2M" onChange={(e) => setNom(e.target.value)} />
          </FormField>
        )}
        <FormField label="Descendant (Mb/s)">
          <Input
            type="number"
            min={0}
            step="0.1"
            value={descendant}
            onChange={(e) => setDescendant(e.target.value)}
            placeholder="sans bridage"
          />
        </FormField>
        <FormField label="Montant (Mb/s)">
          <Input
            type="number"
            min={0}
            step="0.1"
            value={montant}
            onChange={(e) => setMontant(e.target.value)}
            placeholder="sans bridage"
          />
        </FormField>
        <FormField label="Volume total (Go)">
          <Input
            type="number"
            min={0}
            step="0.1"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="sans plafond"
          />
        </FormField>
        <FormField label="Volume reçu (Go)">
          {/* Distinct du total : un forfait peut laisser télécharger largement
              et brider l'envoi, la voie montante étant la ressource rare. */}
          <Input
            type="number"
            min={0}
            step="0.1"
            value={reçu}
            onChange={(e) => setReçu(e.target.value)}
            placeholder="sans plafond"
          />
        </FormField>
        <FormField label="Volume envoyé (Go)">
          <Input
            type="number"
            min={0}
            step="0.1"
            value={envoyé}
            onChange={(e) => setEnvoyé(e.target.value)}
            placeholder="sans plafond"
          />
        </FormField>
        <FormField label="Durée de connexion">
          <ChampDuree secondes={durée} onChange={setDurée} placeholder="sans plafond" />
        </FormField>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3">
        <p className="text-sm text-slate-700">
          <strong>Remise à zéro des compteurs</strong> — c&apos;est la différence entre « 10 Go »
          et « 10 Go par mois ». Sans période, le quota est consommé une fois pour toutes.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Tous les">
            <ChampDuree secondes={période} onChange={setPériode} placeholder="jamais" />
          </FormField>
          {période != null && (
            <FormField label="À partir du">
              <Input type="date" value={départ} onChange={(e) => setDépart(e.target.value)} />
            </FormField>
          )}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          disabled={enCours}
          onClick={() =>
            onValider({
              name: modification ? limitation.name : nom.trim(),
              rateLimitRxBitsPerSecond: bitsDepuisMbps(descendant),
              rateLimitTxBitsPerSecond: bitsDepuisMbps(montant),
              transferLimitBytes: octetsDepuisGo(total),
              downloadLimitBytes: octetsDepuisGo(reçu),
              uploadLimitBytes: octetsDepuisGo(envoyé),
              uptimeLimitSeconds: durée,
              resetCountersIntervalSeconds: période,
              // RouterOS attend aussi l'heure : minuit, faute de mieux à
              // demander à quelqu'un qui raisonne en jours.
              resetCountersStartTime: période != null && départ ? `${départ} 00:00:00` : null,
            })
          }
        >
          {enCours ? 'Enregistrement…' : modification ? 'Enregistrer' : 'Créer'}
        </Button>
        {onAnnuler && (
          <Button variant="secondary" onClick={onAnnuler}>
            Annuler
          </Button>
        )}
      </div>
    </Card>
  );
}
