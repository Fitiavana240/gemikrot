import { api } from './client';

/**
 * Génération directe de tickets depuis un profil du routeur.
 *
 * **À distinguer des lots de l'écran Tickets.** Un lot naît d'une offre,
 * porte un prix, et chaque ticket y est suivi de la vente à l'expiration. Ce
 * qui est généré ici ne l'est pas : ce sont des comptes bruts sur le routeur,
 * comme le ferait « Generate Voucher » dans WinBox. Ils apparaîtront avec
 * l'origine « hors application ».
 *
 * Cela sert le cas que les lots ne couvrent pas — un profil présent sur le
 * routeur sans offre correspondante dans l'application.
 */
export type CibleGeneration = 'user-manager' | 'hotspot';

export interface CiblesDisponibles {
  userManager: { disponible: boolean; profils: string[] };
  hotspot: { disponible: boolean; profils: string[] };
}

export interface GenerationDemande {
  cible: CibleGeneration;
  profileName: string;
  quantite: number;
  prefixe?: string;
  longueurCode?: number;
  commentaire?: string;
}

export interface GenerationResultat {
  /**
   * Plafond de temps cumulé posé sur chaque compte HotSpot, en secondes.
   *
   * `null` quand le profil n'en portait aucun — et c'est alors à dire : les
   * tickets partent sans borne cumulée, et leur `session-timeout` repart à
   * zéro à chaque reconnexion.
   */
  plafondCumule?: number | null;
  cible: CibleGeneration;
  profileName: string;
  /** Les codes réellement créés. */
  codes: string[];
  /** Ce qui a échoué — la génération ne s'arrête pas au premier. */
  echecs: { code: string; motif: string }[];
}

export const ticketGenerationApi = {
  /** Ce que ce routeur sait faire : User Manager n'est pas toujours installé. */
  targets: (routerId: string) =>
    api.get<CiblesDisponibles>(`/routers/${routerId}/tickets/targets`),
  generer: (routerId: string, demande: GenerationDemande) =>
    api.post<GenerationResultat>(`/routers/${routerId}/tickets/generate`, demande),
};
