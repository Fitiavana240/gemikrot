import { useState } from 'react';
import type { CreateLimitationInput, UserManagerLimitation } from '../api/user-manager';
import { ChampDuree } from './Edition';
import { Button, FormField, Input } from './ui';
import { Modale } from './Modale';

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
  // Les neuf champs que WinBox propose et que ce formulaire ignorait. Le
  // routeur les portait déjà : seul l'écran ne savait ni les lire ni les poser.
  const [minDesc, setMinDesc] = useState(mbpsDepuisBits(limitation?.rateLimitMin?.rxBitsPerSecond));
  const [minMont, setMinMont] = useState(mbpsDepuisBits(limitation?.rateLimitMin?.txBitsPerSecond));
  const [priorité, setPriorité] = useState(
    limitation?.rateLimitPriority != null ? String(limitation.rateLimitPriority) : '',
  );
  const [pointeDesc, setPointeDesc] = useState(
    mbpsDepuisBits(limitation?.rateLimitBurst?.rxBitsPerSecond),
  );
  const [pointeMont, setPointeMont] = useState(
    mbpsDepuisBits(limitation?.rateLimitBurst?.txBitsPerSecond),
  );
  const [seuilDesc, setSeuilDesc] = useState(
    mbpsDepuisBits(limitation?.rateLimitBurstThreshold?.rxBitsPerSecond),
  );
  const [seuilMont, setSeuilMont] = useState(
    mbpsDepuisBits(limitation?.rateLimitBurstThreshold?.txBitsPerSecond),
  );
  const [duréePointeDesc, setDuréePointeDesc] = useState<number | null>(
    limitation?.rateLimitBurstTimeSeconds?.rx ?? null,
  );
  const [duréePointeMont, setDuréePointeMont] = useState<number | null>(
    limitation?.rateLimitBurstTimeSeconds?.tx ?? null,
  );
  const [avancé, setAvancé] = useState(false);

  const valider = () =>
    onValider({
      name: modification ? limitation.name : nom.trim(),
      rateLimitRxBitsPerSecond: bitsDepuisMbps(descendant),
      rateLimitTxBitsPerSecond: bitsDepuisMbps(montant),
      transferLimitBytes: octetsDepuisGo(total),
      downloadLimitBytes: octetsDepuisGo(reçu),
      uploadLimitBytes: octetsDepuisGo(envoyé),
      uptimeLimitSeconds: durée,
      resetCountersIntervalSeconds: période,
      // RouterOS attend aussi l'heure : minuit, faute de mieux à demander à
      // quelqu'un qui raisonne en jours.
      resetCountersStartTime: période != null && départ ? `${départ} 00:00:00` : null,
      rateLimitMinRxBitsPerSecond: bitsDepuisMbps(minDesc),
      rateLimitMinTxBitsPerSecond: bitsDepuisMbps(minMont),
      // Zéro est une priorité valide — la plus forte — donc un champ vide et
      // « 0 » ne veulent pas dire la même chose ici.
      rateLimitPriority: priorité.trim() === '' ? null : Number(priorité),
      rateLimitBurstRxBitsPerSecond: bitsDepuisMbps(pointeDesc),
      rateLimitBurstTxBitsPerSecond: bitsDepuisMbps(pointeMont),
      rateLimitBurstThresholdRxBitsPerSecond: bitsDepuisMbps(seuilDesc),
      rateLimitBurstThresholdTxBitsPerSecond: bitsDepuisMbps(seuilMont),
      rateLimitBurstTimeRxSeconds: duréePointeDesc,
      rateLimitBurstTimeTxSeconds: duréePointeMont,
    });

  return (
    <Modale
      large
      titre={modification ? `Modifier « ${limitation.name} »` : 'Nouvelle limitation'}
      onFermer={() => onAnnuler?.()}
      actions={
        <Button disabled={enCours} onClick={valider}>
          {enCours ? 'Enregistrement…' : modification ? 'Enregistrer' : 'Créer'}
        </Button>
      }
      note={
        modification ? (
          <>
            Ceci <strong>s&apos;applique à tous</strong> les abonnés qui utilisent cette
            limitation, dès leur prochaine connexion — y compris ceux dont le ticket est déjà
            vendu.
          </>
        ) : (
          <>
            Une limitation ne s&apos;applique à personne tant qu&apos;elle n&apos;est pas
            rattachée à un forfait, dans l&apos;onglet <em>Limitations par forfait</em>. Les
            champs laissés vides valent « aucune limite ».
          </>
        )
      }
    >

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

      {/* Repliés : ces neuf-là servent au réglage fin et n'entrent en jeu
          qu'en concurrence. Les déplier d'office ferait d'un formulaire de
          quatre champs un mur de quinze, pour un usage rare. */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setAvancé((v) => !v)}
          className="text-sm font-medium text-sky-700 hover:underline"
        >
          {avancé ? 'Masquer' : 'Afficher'} le réglage fin — garanti, priorité, pointe
        </button>
      </div>

      {avancé && (
        <div className="mt-3 space-y-4 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3">
          <div>
            <p className="text-sm text-slate-700">
              <strong>Débit garanti</strong> — servi d&apos;abord à chacun, avant que le reste
              ne soit distribué. Sans lui, un seul gros consommateur peut affamer les autres
              alors que chacun a « son » plafond : le plafond borne, il ne promet rien.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
              <FormField label="Garanti descendant (Mb/s)">
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={minDesc}
                  placeholder="aucun"
                  onChange={(e) => setMinDesc(e.target.value)}
                />
              </FormField>
              <FormField label="Garanti montant (Mb/s)">
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={minMont}
                  placeholder="aucun"
                  onChange={(e) => setMinMont(e.target.value)}
                />
              </FormField>
              <FormField label="Priorité (0 = la plus forte)">
                <Input
                  type="number"
                  min={0}
                  max={8}
                  value={priorité}
                  placeholder="0"
                  onChange={(e) => setPriorité(e.target.value)}
                />
              </FormField>
            </div>
          </div>

          <div>
            <p className="text-sm text-slate-700">
              <strong>Pointe</strong> — le débit toléré au-dessus du plafond pendant quelques
              secondes. C&apos;est ce qui rend la navigation vive avec un forfait bas : les
              premières secondes passent en pointe, puis le débit retombe.{' '}
              <strong>Les trois vont ensemble</strong> : une pointe sans durée ne s&apos;applique
              jamais.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField label="Pointe descendante (Mb/s)">
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={pointeDesc}
                  placeholder="aucune"
                  onChange={(e) => setPointeDesc(e.target.value)}
                />
              </FormField>
              <FormField label="Pointe montante (Mb/s)">
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={pointeMont}
                  placeholder="aucune"
                  onChange={(e) => setPointeMont(e.target.value)}
                />
              </FormField>
              <FormField label="Seuil descendant (Mb/s)">
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={seuilDesc}
                  placeholder="aucun"
                  onChange={(e) => setSeuilDesc(e.target.value)}
                />
              </FormField>
              <FormField label="Seuil montant (Mb/s)">
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={seuilMont}
                  placeholder="aucun"
                  onChange={(e) => setSeuilMont(e.target.value)}
                />
              </FormField>
              <FormField label="Durée de pointe descendante">
                <ChampDuree
                  secondes={duréePointeDesc}
                  onChange={setDuréePointeDesc}
                  placeholder="aucune"
                />
              </FormField>
              <FormField label="Durée de pointe montante">
                <ChampDuree
                  secondes={duréePointeMont}
                  onChange={setDuréePointeMont}
                  placeholder="aucune"
                />
              </FormField>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Le <strong>seuil</strong> est la moyenne au-dessus de laquelle la pointe cesse
              d&apos;être accordée : il évite qu&apos;un téléchargement continu en profite en
              permanence.
            </p>
          </div>
        </div>
      )}
    </Modale>
  );
}
