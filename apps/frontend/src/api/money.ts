import { useQuery } from '@tanstack/react-query';
import { tenantsApi } from './tenants';

/**
 * Formate un montant dans la devise de l'exploitant. Les montants arrivent en
 * chaîne (Decimal côté Prisma) pour ne pas perdre de précision en route.
 */
export function formatMoney(amount: string | number, currency: string): string {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      // L'ariary n'a pas de sous-unité en usage courant.
      maximumFractionDigits: currency === 'MGA' ? 0 : 2,
    }).format(value);
  } catch {
    // Code de devise inconnu d'Intl : on reste lisible plutôt que d'échouer.
    return `${value.toLocaleString('fr-FR')} ${currency}`;
  }
}

/** Devise de l'exploitant connecté, pour l'affichage des montants. */
export function useCurrency(): { currency: string; format: (amount: string | number) => string } {
  const { data } = useQuery({ queryKey: ['tenant-me'], queryFn: tenantsApi.mine, retry: false });
  const currency = data?.currency ?? 'MGA';
  return { currency, format: (amount) => formatMoney(amount, currency) };
}
