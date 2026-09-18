import type { PaymentMethod } from '../api/types';

/**
 * Listes partagées par l'inscription et l'écran Paramètres. Dupliquées, elles
 * divergeaient déjà : « Autre » manquait à l'inscription, si bien qu'un
 * exploitant ne pouvait pas déclarer une puce hors des trois opérateurs.
 */
export const CURRENCIES: { code: string; label: string }[] = [
  { code: 'MGA', label: 'Ariary (MGA)' },
  { code: 'EUR', label: 'Euro (EUR)' },
  { code: 'USD', label: 'Dollar (USD)' },
  { code: 'XOF', label: 'Franc CFA (XOF)' },
];

export const PROVIDERS: { value: PaymentMethod; label: string }[] = [
  { value: 'MVOLA', label: 'MVola' },
  { value: 'ORANGE_MONEY', label: 'Orange Money' },
  { value: 'AIRTEL_MONEY', label: 'Airtel Money' },
  { value: 'OTHER', label: 'Autre' },
];
