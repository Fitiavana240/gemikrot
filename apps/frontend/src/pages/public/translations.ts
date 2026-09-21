/**
 * La page de paiement s'adresse aux clients de Toliara, qui lisent plus
 * facilement le malgache que le français. La console d'administration reste
 * en français : elle s'adresse à l'exploitant.
 */
export type Lang = 'fr' | 'mg';

export const TRANSLATIONS = {
  fr: {
    langName: 'Français',
    chooseOffer: 'Choisissez votre forfait',
    validity: 'Valable',
    devices: 'appareil(s)',
    payTitle: 'Payez par Mobile Money',
    payIntro: 'Envoyez le montant exact au numéro ci-dessous, puis revenez ici.',
    noAccountTitle: 'Le paiement en ligne n’est pas disponible',
    noAccountBody:
      'Aucun numéro Mobile Money n’est enregistré pour ce réseau : il n’y a donc pas d’endroit où envoyer l’argent. Demandez un ticket directement au vendeur.',
    holder: 'Titulaire',
    amountToSend: 'Montant à envoyer',
    confirmTitle: 'Confirmez votre paiement',
    confirmIntro:
      'Saisissez le numéro qui a envoyé l\'argent et la référence figurant dans votre SMS de confirmation.',
    yourName: 'Votre nom',
    yourNameHint: 'Il deviendra votre identifiant de connexion.',
    willBe: 'Votre identifiant sera',
    yourPhone: 'Votre numéro',
    reference: 'Référence du transfert (Trans ID)',
    referenceHint:
        'Elle deviendra votre mot de passe. Recopiez-la exactement comme dans le SMS de l’opérateur — exemple : 6CK4L2M9PQ.',
    checkTwice: 'Relisez avant d’envoyer',
    checkTwiceBody:
        'Votre nom et cette référence sont votre identifiant et votre mot de passe. Une lettre de travers, et votre accès ne s’ouvrira pas : personne ne pourra le corriger à votre place.',
    submit: 'Valider mon paiement',
    submitting: 'Envoi…',
    back: 'Retour',
    waitingTitle: 'Paiement en cours de vérification',
    waitingBody:
      'Votre paiement est en attente de confirmation. Cette page se met à jour toute seule.',
    waitingHint: 'Gardez cette page ouverte, ou revenez avec votre numéro et votre référence.',
    doneTitle: 'Votre accès est prêt',
    doneBody: 'Connectez-vous au Wi-Fi avec ces deux éléments :',
    doneBodySingle: 'Connectez-vous au Wi-Fi et saisissez ce code :',
    doneHint:
        'Ce sont votre nom et la référence de votre transfert — rien de nouveau à retenir.',
    doneHintSingle: 'Notez-le : c’est à la fois votre identifiant et votre mot de passe.',
    loginLabel: 'Identifiant',
    passwordLabel: 'Mot de passe',
    refusedTitle: 'Paiement non validé',
    refusedBody: 'Contactez le vendeur avec votre référence.',
    alreadyPaid: 'J\'ai déjà payé',
    findAccess: 'Retrouver mon accès',
    findIntro: 'Entrez le numéro qui a payé et la référence de votre SMS.',
    search: 'Rechercher',
    needHelp: 'Besoin d\'aide ?',
    whatsapp: 'Écrire sur WhatsApp',
    copied: 'Copié',
    copy: 'Copier',
  },
  mg: {
    langName: 'Malagasy',
    chooseOffer: 'Safidio ny tolotra',
    validity: 'Mandaitra',
    devices: 'fitaovana',
    payTitle: 'Aloa amin\'ny Mobile Money',
    payIntro: 'Alefaso amin\'io laharana io ny vola marina, dia miverena eto.',
    noAccountTitle: 'Tsy azo atao ny fandoavam-bola an-tserasera',
    noAccountBody:
      'Tsy misy laharana Mobile Money voasoratra ho an’ity tambajotra ity : tsy misy toerana handefasana ny vola. Mangataha tapakila mivantana amin’ny mpivarotra.',
    holder: 'Tompon\'ny laharana',
    amountToSend: 'Vola alefa',
    confirmTitle: 'Hamarino ny fandoavam-bola',
    confirmIntro:
      'Ampidiro ny laharana nandefa ny vola sy ny référence hita ao amin\'ny SMS fanamarinana.',
    yourName: 'Ny anaranao',
    yourNameHint: 'Izy no ho anaranao amin’ny fidirana.',
    willBe: 'Ny anaranao amin’ny fidirana dia',
    yourPhone: 'Ny laharanao',
    reference: 'Référence ny fandefasana (Trans ID)',
    referenceHint:
        'Izy no ho tenimiafinao. Adikao mitovy amin’ny SMS avy amin’ny opérateur — ohatra : 6CK4L2M9PQ.',
    checkTwice: 'Hamarino alohan’ny handefasana',
    checkTwiceBody:
        'Ny anaranao sy io référence io no anaranao sy tenimiafinao. Raha misy litera diso dia tsy hisokatra ny fidiranao : tsy misy afaka manitsy izany ho anao.',
    submit: 'Hamarino',
    submitting: 'Andefa…',
    back: 'Hiverina',
    waitingTitle: 'Eo am-panamarinana',
    waitingBody: 'Miandry fanamarinana ny fandoavam-bolanao. Mihavao ho azy ity pejy ity.',
    waitingHint: 'Avelao misokatra ity pejy ity, na miverena amin\'ny laharana sy référence.',
    doneTitle: 'Vonona ny fidiranao',
    doneBody: 'Mifandraisa amin’ny Wi-Fi amin’ireto roa ireto :',
    doneBodySingle: 'Mifandraisa amin’ny Wi-Fi dia ampidiro ity kaody ity :',
    doneHint: 'Ny anaranao sy ny référence ny fandefasanao — tsy misy zavatra vaovao tadidiana.',
    doneHintSingle: 'Soraty : izy no anaranao sady tenimiafinao.',
    loginLabel: 'Anarana',
    passwordLabel: 'Tenimiafina',
    refusedTitle: 'Tsy voamarina ny fandoavam-bola',
    refusedBody: 'Mifandraisa amin\'ny mpivarotra miaraka amin\'ny référence-nao.',
    alreadyPaid: 'Efa nandoa aho',
    findAccess: 'Hitady ny fidirako',
    findIntro: 'Ampidiro ny laharana nandoa sy ny référence ao amin\'ny SMS.',
    search: 'Hitady',
    needHelp: 'Mila fanampiana ?',
    whatsapp: 'Hanoratra amin\'ny WhatsApp',
    copied: 'Voadika',
    copy: 'Adika',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type Dictionary = (typeof TRANSLATIONS)['fr'];

/** Durée en clair, dans la langue choisie. */
export function formatValidity(seconds: number, lang: Lang): string {
  const units =
    lang === 'mg'
      ? { d: 'andro', h: 'ora', m: 'minitra' }
      : { d: 'jour(s)', h: 'heure(s)', m: 'minute(s)' };

  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)} ${units.d}`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} ${units.h}`;
  return `${Math.round(seconds / 60)} ${units.m}`;
}
