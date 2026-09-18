import { Injectable } from '@nestjs/common';
import type { PaymentProvider, PaymentVerificationResult } from './payment-provider.interface.js';

/**
 * La vérification est l'action manuelle de l'admin elle-même (il a constaté
 * le paiement — espèces, ou SMS Mobile Money — avant d'appeler l'endpoint de
 * vérification). Ce provider ne fait donc aucun appel réseau : il matérialise
 * le contrat `PaymentProvider` en attendant une intégration officielle.
 */
@Injectable()
export class ManualPaymentProvider implements PaymentProvider {
  async verify(): Promise<PaymentVerificationResult> {
    return { verified: true };
  }
}
