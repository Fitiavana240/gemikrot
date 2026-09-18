export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface PaymentVerificationResult {
  verified: boolean;
  reason?: string;
}

/**
 * Abstraction de fournisseur de paiement (Section 23). Aucune API Mobile
 * Money officielle n'est intégrée pour l'instant — `ManualPaymentProvider`
 * est la seule implémentation. Une intégration Orange Money / MVola /
 * Airtel Money officiellement supportée pourra être ajoutée plus tard en
 * implémentant cette même interface, sans changer `PaymentsService`.
 */
export interface PaymentProvider {
  verify(reference: string, amountAr: number): Promise<PaymentVerificationResult>;
}
