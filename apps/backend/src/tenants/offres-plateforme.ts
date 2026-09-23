/**
 * Ce que la plateforme vend à ses exploitants, et à quel prix.
 *
 * Le prix n'existait nulle part : `platformPlanName` était un texte libre et
 * `platformEndsAt` une date posée à la main. Un exploitant ne pouvait donc
 * pas savoir ce qu'il devait, et le SUPER_ADMIN devait calculer l'échéance de
 * tête à chaque renouvellement — c'est-à-dire se tromper un jour.
 *
 * **Le prix est par routeur.** Un exploitant à cinq sites coûte cinq fois plus
 * cher à servir qu'un exploitant à un seul : autant de tunnels, de lectures
 * périodiques et de réconciliations. Facturer au compte d'exploitants ferait
 * payer le petit pour le gros.
 *
 * **L'essai ne se renouvelle pas et n'a pas de tolérance.** Cinq jours suivis
 * de quatorze jours de tolérance feraient dix-neuf jours gratuits, et la
 * tolérance existe pour un virement qui traîne — pas pour un essai, qui ne
 * doit rien.
 */

export type CodeOffre = 'ESSAI' | 'MENSUEL' | 'ANNUEL';

export interface OffrePlateforme {
  code: CodeOffre;
  nom: string;
  /** En ariary, par routeur et par période. Zéro pour l'essai. */
  prixParRouteur: number;
  periodeJours: number;
  /** Comment la période se dit, pour l'afficher sans reformuler. */
  periode: string;
  /** Jours de tolérance après l'échéance avant que la vente ne se ferme. */
  toleranceJours: number;
  /**
   * Plafond de routeurs posé à la souscription. `null` = sans limite.
   *
   * L'essai est à un routeur : c'est le geste qu'on veut voir réussir, et
   * ouvrir cinq sites pendant un essai ne prouve rien de plus.
   */
  maxRouteurs: number | null;
  /** Ce qui distingue cette offre, dit en une phrase à l'exploitant. */
  argument: string;
}

/** Deux semaines : le temps d'un virement qui traîne, pas d'un mois gratuit. */
export const TOLERANCE_JOURS = 14;

/** Cinq jours pour brancher un routeur et vendre un premier ticket. */
export const ESSAI_JOURS = 5;

export const OFFRES: OffrePlateforme[] = [
  {
    code: 'ESSAI',
    nom: 'Essai gratuit',
    prixParRouteur: 0,
    periodeJours: ESSAI_JOURS,
    periode: '5 jours',
    toleranceJours: 0,
    maxRouteurs: 1,
    argument:
      "Cinq jours pour raccorder un routeur et vendre un premier accès. Aucun paiement, aucune carte : à l'échéance la vente s'arrête, et rien n'est prélevé.",
  },
  {
    code: 'MENSUEL',
    nom: 'Mensuel',
    prixParRouteur: 7_000,
    periodeJours: 30,
    periode: 'mois',
    toleranceJours: TOLERANCE_JOURS,
    maxRouteurs: null,
    argument:
      "Se règle mois par mois. C'est l'offre à prendre quand on ne sait pas encore combien de temps on gardera le réseau.",
  },
  {
    code: 'ANNUEL',
    nom: 'Annuel',
    prixParRouteur: 60_000,
    periodeJours: 365,
    periode: 'an',
    toleranceJours: TOLERANCE_JOURS,
    maxRouteurs: null,
    argument:
      "Douze mois payés d'avance : 60 000 Ar au lieu de 84 000 Ar, soit 24 000 Ar économisés par routeur et par an.",
  },
];

export function offreParCode(code: string): OffrePlateforme | undefined {
  return OFFRES.find((offre) => offre.code === code);
}

/**
 * Retrouve l'offre derrière un nom enregistré.
 *
 * `platformPlanName` a longtemps été du texte libre : les comptes posés avant
 * ce catalogue portent n'importe quoi. On rend `undefined` plutôt que de
 * deviner — un abonnement qu'on n'identifie pas s'affiche tel qu'il est
 * écrit, et le SUPER_ADMIN le réaligne quand il le renouvelle.
 */
export function offreParNom(nom: string | null | undefined): OffrePlateforme | undefined {
  if (!nom) return undefined;
  const cherché = nom.trim().toLowerCase();
  return OFFRES.find(
    (offre) => offre.nom.toLowerCase() === cherché || offre.code.toLowerCase() === cherché,
  );
}

/** Millisecondes d'une journée, pour un compte de jours lisible. */
export const JOUR_MS = 86_400_000;

/**
 * L'échéance après souscription, en repartant de la fin de la période en
 * cours quand il en reste une.
 *
 * Renouveler le 20 un abonnement qui court jusqu'au 30 ne doit pas faire
 * perdre dix jours déjà payés. Mais une échéance **dépassée** ne se prolonge
 * pas depuis le passé : on repart d'aujourd'hui, sinon payer un mois après
 * trois mois d'absence n'ouvrirait rien.
 */
export function prochaineEcheance(
  echeanceActuelle: Date | null,
  offre: OffrePlateforme,
  maintenant = new Date(),
): Date {
  const depart =
    echeanceActuelle && echeanceActuelle > maintenant ? echeanceActuelle : maintenant;
  return new Date(depart.getTime() + offre.periodeJours * JOUR_MS);
}

/**
 * Ce que l'exploitant doit pour une période, d'après son parc.
 *
 * Compté sur au moins un routeur : un exploitant qui n'en a encore raccordé
 * aucun verrait « 0 Ar » et croirait la plateforme gratuite.
 */
export function montantDu(offre: OffrePlateforme, routeurs: number): number {
  return offre.prixParRouteur * Math.max(routeurs, 1);
}

/**
 * A qui l'exploitant s'adresse pour payer.
 *
 * Il n'existe aucune table pour cela, et il ne doit pas en exister : la
 * plateforme n'est pas un exploitant, elle n'a ni fiche ni cloisonnement. Ces
 * trois valeurs sont de la configuration de deploiement, au meme titre que
 * l'origine CORS.
 *
 * **Tout vide, la page de blocage ne ment pas** : elle dit qu'aucun moyen de
 * contact n'est configure, plutot que d'afficher un numero mort a quelqu'un
 * qui cherche a payer.
 */
export interface ContactPlateforme {
  telephone: string | null;
  /** Chiffres seuls, tel que l'attend `wa.me` : `261340000000`. */
  whatsapp: string | null;
  courriel: string | null;
}

export function contactPlateforme(env: NodeJS.ProcessEnv = process.env): ContactPlateforme {
  const lire = (cle: string) => {
    const valeur = env[cle]?.trim();
    return valeur ? valeur : null;
  };
  return {
    telephone: lire('PLATEFORME_CONTACT_TELEPHONE'),
    whatsapp: lire('PLATEFORME_CONTACT_WHATSAPP'),
    courriel: lire('PLATEFORME_CONTACT_COURRIEL'),
  };
}
