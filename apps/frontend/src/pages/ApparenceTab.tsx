import { useState } from 'react';
import { Card } from '../components/ui';
import { lireTheme, poserTheme, type Theme } from '../theme';

/**
 * Clair, sombre, ou comme l'appareil.
 *
 * Ce parc se tient à Toliara : la console s'ouvre au comptoir en plein jour et
 * le soir après la fermeture. Les deux ne demandent pas le même écran, et
 * imposer l'un des deux revient à gêner la moitié des heures de travail.
 *
 * Le choix reste dans le navigateur, pas en base : c'est une préférence
 * d'écran, et le même compte ouvert sur le téléphone du comptoir et sur
 * l'ordinateur du bureau peut légitimement vouloir deux réglages.
 */

const CHOIX: { valeur: Theme; label: string; aide: string }[] = [
  { valeur: 'systeme', label: 'Comme l’appareil', aide: 'Suit le réglage de votre téléphone ou de votre ordinateur.' },
  { valeur: 'clair', label: 'Clair', aide: 'Le plus lisible au soleil.' },
  { valeur: 'sombre', label: 'Sombre', aide: 'Moins fatigant le soir.' },
];

export function ApparenceTab() {
  const [theme, setTheme] = useState<Theme>(() => lireTheme());

  return (
    <Card title="Apparence">
      <div className="grid gap-2 sm:grid-cols-3">
        {CHOIX.map((c) => (
          <button
            key={c.valeur}
            type="button"
            onClick={() => {
              poserTheme(c.valeur);
              setTheme(c.valeur);
            }}
            aria-pressed={theme === c.valeur}
            className={`rounded-lg border px-3 py-3 text-left transition-colors ${
              theme === c.valeur
                ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-500/20'
                : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span className="block text-sm font-medium text-slate-800">{c.label}</span>
            <span className="mt-0.5 block text-xs text-slate-500">{c.aide}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 max-w-2xl text-xs text-slate-500">
        Le choix vaut pour <strong>cet appareil</strong>, pas pour votre compte : la console
        du comptoir et celle du bureau ne se lisent pas dans la même lumière. À
        l&apos;impression, une planche de tickets reste toujours claire — on ne vide pas une
        cartouche pour un fond sombre.
      </p>
    </Card>
  );
}
