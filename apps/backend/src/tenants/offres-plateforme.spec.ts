import { describe, expect, it } from 'vitest';
import {
  ESSAI_JOURS,
  OFFRES,
  contactPlateforme,
  montantDu,
  offreParCode,
  offreParNom,
  prochaineEcheance,
} from './offres-plateforme.js';

/**
 * Le catalogue de la plateforme.
 *
 * Ce qui se vérifie ici n'est pas le contenu des offres — il changera — mais
 * les trois règles qui décident de l'argent : on ne perd pas une période
 * déjà payée, on ne prolonge pas depuis le passé, et un essai ne traîne pas
 * derrière lui une tolérance qui le doublerait.
 */

const jours = (n: number) => new Date(Date.now() + n * 86_400_000);
const mensuel = offreParCode('MENSUEL')!;
const annuel = offreParCode('ANNUEL')!;
const essai = offreParCode('ESSAI')!;

describe('le catalogue', () => {
  it('vend l’année moins cher que douze mois', () => {
    // C'est toute la raison d'être de l'offre annuelle. Si l'égalité se
    // produisait un jour par une retouche de prix, personne ne la prendrait
    // et personne ne s'en apercevrait.
    expect(annuel.prixParRouteur).toBeLessThan(mensuel.prixParRouteur * 12);
  });

  it('n’accorde aucune tolérance à l’essai', () => {
    // Cinq jours d'essai plus quatorze de tolérance feraient dix-neuf jours
    // gratuits. La tolérance couvre un virement qui traîne ; un essai ne doit
    // rien, donc rien ne traîne.
    expect(essai.toleranceJours).toBe(0);
    expect(essai.prixParRouteur).toBe(0);
    expect(essai.periodeJours).toBe(ESSAI_JOURS);
  });

  it('limite l’essai à un seul routeur', () => {
    expect(essai.maxRouteurs).toBe(1);
    // Les offres payantes, elles, ne plafonnent rien : le prix est déjà par
    // routeur, plafonner en plus ferait payer sans servir.
    expect(mensuel.maxRouteurs).toBeNull();
    expect(annuel.maxRouteurs).toBeNull();
  });

  it('retrouve une offre par son code comme par son nom', () => {
    expect(offreParNom('Mensuel')?.code).toBe('MENSUEL');
    expect(offreParNom('  annuel  ')?.code).toBe('ANNUEL');
    expect(offreParNom('MENSUEL')?.code).toBe('MENSUEL');
  });

  it('ne devine rien d’un nom écrit à la main', () => {
    // `platformPlanName` a longtemps été du texte libre. Un abonnement qu'on
    // n'identifie pas doit s'afficher tel qu'il est écrit, sans montant :
    // un chiffre inventé serait pire que pas de chiffre.
    expect(offreParNom('Forfait spécial Tsiravay')).toBeUndefined();
    expect(offreParNom(null)).toBeUndefined();
    expect(offreParNom('')).toBeUndefined();
  });
});

describe('le montant dû', () => {
  it('multiplie par le nombre de routeurs', () => {
    expect(montantDu(mensuel, 3)).toBe(21_000);
    expect(montantDu(annuel, 2)).toBe(120_000);
  });

  it('compte un routeur à celui qui n’en a pas encore raccordé', () => {
    // Afficher « 0 Ar » à un compte neuf lui ferait croire la plateforme
    // gratuite, et le blocage du sixième jour serait incompréhensible.
    expect(montantDu(mensuel, 0)).toBe(mensuel.prixParRouteur);
  });
});

describe('la prochaine échéance', () => {
  it('repart de la fin de la période en cours', () => {
    // Renouveler le 20 un abonnement qui court jusqu'au 30 ne doit pas faire
    // perdre les dix jours déjà payés.
    const dans10Jours = jours(10);
    const suite = prochaineEcheance(dans10Jours, mensuel);

    expect(suite.getTime()).toBe(dans10Jours.getTime() + mensuel.periodeJours * 86_400_000);
  });

  it('repart d’aujourd’hui quand l’échéance est dépassée', () => {
    // Sinon, payer un mois après trois mois d'absence n'ouvrirait rien : la
    // nouvelle échéance tomberait encore dans le passé.
    const maintenant = new Date();
    const suite = prochaineEcheance(jours(-90), mensuel, maintenant);

    expect(suite.getTime()).toBeGreaterThan(maintenant.getTime());
    expect(suite.getTime()).toBe(maintenant.getTime() + mensuel.periodeJours * 86_400_000);
  });

  it('part d’aujourd’hui pour une première souscription', () => {
    const maintenant = new Date();

    expect(prochaineEcheance(null, annuel, maintenant).getTime()).toBe(
      maintenant.getTime() + annuel.periodeJours * 86_400_000,
    );
  });
});

describe('le contact de la plateforme', () => {
  it('rend tout à null quand rien n’est configuré', () => {
    // La page de blocage dit alors franchement qu'aucun moyen de contact
    // n'existe, plutôt que d'afficher un numéro mort à quelqu'un qui cherche
    // justement à payer.
    expect(contactPlateforme({})).toEqual({ telephone: null, whatsapp: null, courriel: null });
  });

  it('ignore une valeur réduite à des espaces', () => {
    // Un `.env` renseigné à moitié est la forme la plus courante du numéro
    // mort : la variable existe, elle ne contient rien.
    const contact = contactPlateforme({
      PLATEFORME_CONTACT_TELEPHONE: '   ',
      PLATEFORME_CONTACT_WHATSAPP: '261340000000',
    });

    expect(contact.telephone).toBeNull();
    expect(contact.whatsapp).toBe('261340000000');
  });
});

describe('la cohérence du catalogue', () => {
  it('n’a pas deux offres sous le même code', () => {
    const codes = OFFRES.map((o) => o.code);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it('donne à chaque offre une période non nulle', () => {
    // Une période à zéro poserait une échéance à l'instant même de la
    // souscription : l'exploitant paierait et serait bloqué dans la seconde.
    for (const offre of OFFRES) {
      expect(offre.periodeJours).toBeGreaterThan(0);
    }
  });
});
