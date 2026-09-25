import { describe, expect, it, vi } from 'vitest';
import {
  autoriseParLeWalledGarden,
  contrasteAvecBlanc,
  duree,
  exigerLogoUtilisable,
  memeReseau24,
  exigerCouleurLisible,
  estAdresseIPv4,
  hoteDe,
  PageConnexionService,
} from './page-connexion.service.js';

/**
 * Où la page va, et ce qui l'empêche d'y aller.
 *
 * Le chemin était en dur : `flash/hotspot/login.html`. Il se trouve juste sur
 * le parc de Toliara — le profil qui sert vraiment y pointe — et faux dès
 * qu'un serveur HotSpot utilise le profil `default`, qui sert depuis
 * `hotspot`. La console écrivait alors un fichier **que personne ne sert**, en
 * annonçant « page écrite, 6 000 octets ». Un succès affiché pour un geste
 * sans effet est la pire panne possible : on cherche la cause partout sauf là.
 */

const TENANT = {
  slug: 'zone-wifi-tati',
  wifiName: 'Zone WIFI-TATI',
  name: 'Tati',
  currency: 'MGA',
};

/** Les offres de ce parc, telles qu'elles sont en base. */
const OFFRES = [
  { id: 'p1', name: '2Heure-500Ar', price: 500, validityDurationSeconds: 7200, maxSharedUsers: 1 },
  {
    id: 'p2',
    name: '4Heure-1000Ar',
    price: 1000,
    validityDurationSeconds: 14400,
    maxSharedUsers: 1,
  },
  { id: 'p3', name: '1Jour-2000Ar', price: 2000, validityDurationSeconds: 86400, maxSharedUsers: 1 },
  {
    id: 'p4',
    name: 'Abo-25000Ar-2Appareils',
    price: 25000,
    validityDurationSeconds: 2592000,
    maxSharedUsers: 2,
  },
];

function service(options: {
  serveurs?: any[];
  profils?: any[];
  fichiers?: any[];
  wgAdresses?: any[];
  publications?: any[];
  puces?: number;
  reglages?: Record<string, unknown> | null;
  /** Ce que la console croit etre ses adresses. Pose, jamais lu. */
  adressesLocales?: string[];
  /**
   * `PUBLIC_BASE_URL`. Absente par defaut : la plupart des epreuves portent
   * sur le montage de labo, ou la console repond sur le reseau du routeur.
   */
  basePublique?: string;
}) {
  const mikrotik = {
    getHotspotServers: vi.fn(async () => options.serveurs ?? []),
    getHotspotServerProfiles: vi.fn(async () => options.profils ?? []),
    getRouterFiles: vi.fn(async () => options.fichiers ?? []),
    getWalledGarden: vi.fn(async () => [] as any[]),
    // Par défaut l'adresse d'essai est autorisée : sans cela, chaque épreuve
    // porterait un avertissement de Walled Garden sans rapport avec ce
    // qu'elle vérifie.
    getWalledGardenIps: vi.fn(async () =>
      options.wgAdresses ?? [
        {
          dstAddress: '192.168.88.135',
          dstPort: '5173',
          action: 'accept',
          disabled: false,
        },
      ],
    ),
    writeRouterFile: vi.fn(async () => undefined),
    createWalledGardenEntry: vi.fn(async () => ({})),
    createWalledGardenIpEntry: vi.fn(async () => ({})),
  };

  const prisma: any = {
    tenant: { findUnique: vi.fn(async () => ({ ...TENANT, domains: ['wifitati.net'] })) },
    hotspotLoginPage: {
      findUnique: vi.fn(async () => options.reglages ?? null),
      upsert: vi.fn(async () => ({})),
    },
    hotspotLoginPublication: {
      findMany: vi.fn(async () => options.publications ?? []),
      upsert: vi.fn(async () => ({})),
    },
    scopedStrict: {
      plan: { findMany: vi.fn(async () => OFFRES) },
      mobileMoneyAccount: { count: vi.fn(async () => options.puces ?? 1) },
    },
  };

  const s = new PageConnexionService(
    prisma,
    { requireTenantId: () => 't1' } as never,
    { forRouter: async () => mikrotik, forDefaultRouter: async () => mikrotik } as never,
    { log: vi.fn(async () => undefined) } as never,
    { get: () => options.basePublique } as never,
  );
  // L'adresse de la console est **posee**, jamais lue sur la machine : la
  // lire ferait dependre la suite du bail DHCP du poste qui l'execute, et
  // le jour ou ce bail change les epreuves decrivent une panne inexistante.
  s.adressesDeLaMachine = () => options.adressesLocales ?? ['192.168.88.135'];
  return { service: s, mikrotik, prisma };
}

/** Un profil qui accepte le mot de passe en clair, comme celui de ce parc. */
const profil = (nom: string, dossier: string | null, extra: Record<string, unknown> = {}) => ({
  name: nom,
  htmlDirectory: dossier,
  loginBy: ['mac', 'cookie', 'http-chap', 'https', 'http-pap', 'mac-cookie'],
  dnsName: null,
  hotspotAddress: null,
  ...extra,
});

const OK = { reglages: { portailUrl: 'http://192.168.88.135:5173' } };

describe('où la page est écrite', () => {
  it('suit le dossier du profil qui sert vraiment', async () => {
    const { service: s } = service({
      serveurs: [{ name: 'hotspot-tati', profileName: 'hsprof-tati', disabled: false }],
      profils: [profil('default', 'hotspot'), profil('hsprof-tati', 'flash/hotspot')],
      ...OK,
    });

    const etat = await s.etat('r1');

    // `default` existe sur ce routeur et sert depuis `hotspot` : aucun serveur
    // ne l'utilise, donc il n'est pas une cible.
    expect(etat.cibles.map((c) => c.chemin)).toEqual(['flash/hotspot/login.html']);
  });

  it('retombe sur le dossier par défaut quand le profil n’en nomme pas', async () => {
    const { service: s } = service({
      serveurs: [{ name: 'hs1', profileName: 'default', disabled: false }],
      profils: [profil('default', null)],
      ...OK,
    });

    expect((await s.etat('r1')).cibles[0].chemin).toBe('hotspot/login.html');
  });

  it('ignore un serveur désactivé', async () => {
    // Publier dans le dossier d'un serveur éteint, c'est exactement le défaut
    // qu'on corrige : écrire là où personne ne lit.
    const { service: s } = service({
      serveurs: [{ name: 'eteint', profileName: 'default', disabled: true }],
      profils: [profil('default', 'hotspot')],
      ...OK,
    });

    const etat = await s.etat('r1');

    expect(etat.cibles).toHaveLength(0);
    expect(etat.empechements.join(' ')).toMatch(/aucun serveur hotspot actif/i);
  });

  it('écrit dans chaque dossier servi quand ils diffèrent', async () => {
    const { service: s, mikrotik } = service({
      serveurs: [
        { name: 'a', profileName: 'pa', disabled: false },
        { name: 'b', profileName: 'pb', disabled: false },
      ],
      profils: [profil('pa', 'hotspot'), profil('pb', 'flash/hotspot')],
      ...OK,
    });

    const { ecrits } = await s.publier('admin-1', 'r1');

    expect(ecrits.map((e) => e.chemin).sort()).toEqual([
      'flash/hotspot/login.html',
      'hotspot/login.html',
    ]);
    expect(mikrotik.writeRouterFile).toHaveBeenCalledTimes(2);
  });
});

describe('ce qui empêche de publier', () => {
  it('refuse quand le profil n’accepte pas le mot de passe en clair', async () => {
    // La page envoie le mot de passe en clair. Sans `http-pap`, la publier
    // ferme la porte à tout le monde, clients payants compris — et cela ne se
    // rattrape qu'en se déplaçant sur site.
    const { service: s, mikrotik } = service({
      serveurs: [{ name: 'hs1', profileName: 'p', disabled: false }],
      profils: [profil('p', 'hotspot', { loginBy: ['http-chap', 'cookie'] })],
      ...OK,
    });

    const etat = await s.etat('r1');
    expect(etat.empechements.join(' ')).toMatch(/http-pap/);

    await expect(s.publier('admin-1', 'r1')).rejects.toThrow(/http-pap/);
    expect(mikrotik.writeRouterFile).not.toHaveBeenCalled();
  });

  it('refuse l’adresse du portail captif lui-même', async () => {
    // Le profil de ce parc porte `dns-name = wifitati.net`. Pour un client non
    // connecté, ce nom mène au routeur : le bouton d'achat le renverrait sur
    // la page qu'il vient de quitter, en boucle.
    const { service: s } = service({
      serveurs: [{ name: 'hs1', profileName: 'p', disabled: false }],
      profils: [profil('p', 'hotspot', { dnsName: 'wifitati.net' })],
      reglages: { portailUrl: 'http://wifitati.net' },
    });

    expect((await s.etat('r1')).empechements.join(' ')).toMatch(/en boucle/);
  });

  it('refuse une adresse de portail vide', async () => {
    const { service: s } = service({
      serveurs: [{ name: 'hs1', profileName: 'p', disabled: false }],
      profils: [profil('p', 'hotspot')],
      reglages: null,
    });

    expect((await s.etat('r1')).empechements.join(' ')).toMatch(/ne mènerait nulle part/);
  });

  it('signale une page remplacée depuis WinBox', async () => {
    // La comparaison se fait sur la taille : RouterOS ne rend un fichier que
    // sous 4 096 octets, et une page de connexion dépasse ce seuil. C'est une
    // détection de divergence, pas une vérification de contenu.
    const { service: s, prisma } = service({
      serveurs: [{ name: 'hs1', profileName: 'p', disabled: false }],
      profils: [profil('p', 'hotspot')],
      fichiers: [
        { name: 'hotspot/login.html', sizeBytes: 4360, lastModified: '2026-07-02 14:04:23' },
      ],
      ...OK,
    });
    prisma.hotspotLoginPublication.findMany = vi.fn(async () => [
      { chemin: 'hotspot/login.html', octets: 6200, publieLe: new Date() },
    ]);

    expect((await s.etat('r1')).avertissements.join(' ')).toMatch(/remplacée depuis/);
  });
});

describe('le bouton d’achat', () => {
  it('est présent quoi que l’exploitant saisisse', async () => {
    // Le cœur du dispositif : le bloc n'est pas dans ce que l'exploitant
    // édite, donc il ne peut pas le retirer. Il en change les mots.
    const { service: s } = service({
      reglages: { libelleAchat: 'Payer maintenant', portailUrl: 'http://10.0.0.2:5173' },
    });

    const { contenu } = await s.apercu();

    expect(contenu).toContain('class="payer"');
    expect(contenu).toContain('href="http://10.0.0.2:5173/p/zone-wifi-tati"');
    expect(contenu).toContain('Payer maintenant');
  });

  it('survit à une tentative de fermeture de balise', async () => {
    // Un titre contenant `</a>` ou `<script>` casserait la page — celle qu'on
    // ne peut justement pas se permettre de casser.
    const { service: s } = service({ reglages: { portailUrl: 'http://10.0.0.2:5173' } });

    const { contenu } = await s.apercu({ titre: '</a><script>alert(1)</script>' });

    expect(contenu).not.toContain('<script>alert(1)');
    expect(contenu).toContain('&lt;script&gt;');
    expect(contenu).toContain('class="payer"');
  });

  it('ne sert pas au client la documentation du modele', async () => {
    // Le commentaire de tete **liste les marqueurs** : `replaceAll` les y
    // remplacait aussi, et le tableau des tarifs se retrouvait ecrit une
    // seconde fois a l'interieur d'un commentaire. Invisible, mais 2 800
    // octets de plus dans un fichier qui voyage par une API plafonnee.
    const { service: s } = service({ reglages: { portailUrl: 'http://10.0.0.2:5173' } });

    const { contenu } = await s.apercu();

    expect(contenu).not.toContain('Page captive HotSpot');
    expect(contenu.split('class="tarifs"')).toHaveLength(2);
    expect(contenu.split('class="payer"')).toHaveLength(2);
  });

  it('ne laisse aucun marqueur non remplacé', async () => {
    // Un `__TRUC__` oublié s'afficherait tel quel au client.
    const { service: s } = service({ reglages: { portailUrl: 'http://10.0.0.2:5173' } });

    const { contenu } = await s.apercu();

    expect(contenu).not.toMatch(/__[A-Z_]+__/);
  });

  it('ne produit que de l’ASCII', async () => {
    // L'API du routeur refuse tout octet au-dessus de 127 : un accent dans le
    // nom du réseau ferait échouer la publication, pas l'aperçu.
    const { service: s } = service({
      reglages: { titre: 'Réseau Café', portailUrl: 'http://10.0.0.2:5173' },
    });

    const { contenu } = await s.apercu();

    expect([...contenu].find((c) => c.charCodeAt(0) > 127)).toBeUndefined();
  });
});

describe('le tableau des tarifs', () => {
  it('vient des offres, pas d’une saisie', async () => {
    // L'affiche écrite à la main de ce parc annonçait « 1 Ora » pour 500 Ar
    // alors que le routeur en donne deux. Calculé, le tableau ne peut plus
    // annoncer une durée qui n'est pas celle qu'on livre.
    const { service: s } = service({ reglages: { portailUrl: 'http://10.0.0.2:5173' } });

    const { contenu } = await s.apercu();

    expect(contenu).toContain('class="tarifs"');
    expect(contenu).toContain('500 MGA');
    expect(contenu).toContain('2 h');
    // Et l'offre que l'affiche taisait.
    expect(contenu).toContain('1 000 MGA');
    expect(contenu).toContain('4 h');
    // Le nombre d'appareils, quand il dépasse un.
    expect(contenu).toContain('2 appareils');
  });

  it('disparaît quand on ne le veut pas', async () => {
    const { service: s } = service({ reglages: { portailUrl: 'http://10.0.0.2:5173' } });

    const { contenu } = await s.apercu({ afficherTarifs: false } as never);

    expect(contenu).not.toContain('class="tarifs"');
    // Le bouton d'achat, lui, reste : il n'est pas réglable.
    expect(contenu).toContain('class="payer"');
  });
});

describe('duree', () => {
  it('dit l’unité qui tombe juste', () => {
    // « 720 h » ne veut rien dire au comptoir ; « 1 mois » si.
    expect(duree(7200)).toBe('2 h');
    expect(duree(86400)).toBe('1 jour');
    expect(duree(604800)).toBe('1 semaine');
    expect(duree(2592000)).toBe('1 mois');
    expect(duree(1800)).toBe('30 min');
  });
});

describe('le pied de page', () => {
  it('porte l’adresse, les numéros et la page Facebook', async () => {
    // La vraie page de ce parc les portait. Les perdre en passant par la
    // console serait un recul : c'est par là que les clients appellent.
    const { service: s } = service({
      reglages: {
        portailUrl: 'http://10.0.0.2:5173',
        piedDePage: 'Zone Wifi-TATI',
        adresse: "Motombe-Tanambao, ambadik'i Garage Belia Rasta",
        telephones: '034 72 818 91 - 033 12 835 90',
        reseauSocial: 'Zone Wifi-TATI',
      },
    });

    const { contenu } = await s.apercu();

    expect(contenu).toContain('Motombe-Tanambao');
    expect(contenu).toContain('034 72 818 91');
    // Rien de cliquable : un client captif n'a pas Internet, et un lien
    // Facebook ne mènerait nulle part.
    expect(contenu).not.toContain('facebook.com');
    expect(contenu).not.toContain('tel:');
  });

  it('ne laisse pas de ligne vide quand un champ manque', async () => {
    const { service: s } = service({
      reglages: { portailUrl: 'http://10.0.0.2:5173', piedDePage: 'Tati' },
    });

    const { contenu } = await s.apercu();

    expect(contenu).toContain('<div class="footer">Tati</div>');
  });
});

describe('les emoji', () => {
  it('survivent à l’ASCII, en entités valides', async () => {
    // `charCodeAt` rendait la moitié haute du couple de substitution : le
    // signal Wi-Fi devenait `&#55357;`, un demi-caractère que le navigateur
    // affiche en losange. Les quatre emoji de la page de ce parc sont
    // précisément ce qui l'empêchait de passer par l'API du routeur.
    const { service: s } = service({
      reglages: {
        portailUrl: 'http://10.0.0.2:5173',
        titre: String.fromCodePoint(0x1f4f6) + ' ZONE WIFI-TATI',
      },
    });

    const { contenu } = await s.apercu();

    expect(contenu).toContain('&#128246;');
    expect(contenu).not.toContain('&#55357;');
    expect([...contenu].find((c) => (c.codePointAt(0) ?? 0) > 127)).toBeUndefined();
  });
});

describe('la santé du parcours d’achat', () => {
  /** Un routeur normal : un serveur actif, un profil qui accepte le PAP. */
  const parc = {
    serveurs: [{ name: 'hotspot-tati', profileName: 'p', disabled: false }],
    // `hotspotAddress` porte l'adresse du portail : c'est elle qui dit sur
    // quel reseau chercher la console. Sans elle, aucune adresse n'est
    // deduite -- le profil `default` de ce routeur, qui annonce `0.0.0.0`,
    // est dans ce cas.
    profils: [profil('p', 'flash/hotspot', { hotspotAddress: '192.168.88.1' })],
  };

  it('dit que tout va bien quand tout va bien', async () => {
    const { service: s } = service({
      ...parc,
      reglages: { portailUrl: 'http://192.168.88.135:5173' },
      publications: [
        {
          chemin: 'flash/hotspot/login.html',
          octets: 9404,
          portailUrl: 'http://192.168.88.135:5173',
          publieLe: new Date(),
        },
      ],
    });

    const { sante } = await s.etat('r1');

    expect(sante.operationnel).toBe(true);
    expect(sante.ruptures).toEqual([]);
  });

  it('voit la page qui envoie les clients à une ancienne adresse', async () => {
    // Le cas qui coûte le plus cher, parce qu'il survient tout seul : un bail
    // DHCP renouvelé suffit. Le fichier vit sur le routeur et ne peut pas
    // réagir ; le client tape sur un bouton mort au matin.
    const { service: s } = service({
      ...parc,
      reglages: { portailUrl: 'http://192.168.88.135:5173' },
      publications: [
        {
          chemin: 'flash/hotspot/login.html',
          octets: 9404,
          portailUrl: 'http://192.168.88.250:5173',
          publieLe: new Date(),
        },
      ],
    });

    const { sante } = await s.etat('r1');

    expect(sante.operationnel).toBe(false);
    expect(sante.ruptures.join(' ')).toMatch(/192\.168\.88\.250.*192\.168\.88\.135/);
    expect(sante.adressePubliee).toBe('http://192.168.88.250:5173');
  });

  it('ne déduit aucune adresse quand le profil n’annonce pas la sienne', async () => {
    // Le profil `default` de ce routeur annonce `0.0.0.0`. Sans reseau de
    // reference, proposer une adresse reviendrait a proposer les cartes
    // virtuelles du poste de travail, injoignables depuis le Wi-Fi. Mieux
    // vaut ne rien proposer que proposer faux.
    const { service: s } = service({
      serveurs: [{ name: 'hs1', profileName: 'p', disabled: false }],
      profils: [profil('p', 'hotspot')],
      reglages: { portailUrl: 'http://192.168.88.135:5173' },
    });

    const { adresses, sante } = await s.etat('r1');

    expect(adresses.filter((a) => a.source === 'reseau-local')).toEqual([]);
    expect(sante.adresseActuelle).toBeNull();
  });

  it('voit la page d’origine, jamais remplacée', async () => {
    // Les fichiers d'usine portent tous la seconde d'installation du HotSpot.
    const { service: s } = service({
      ...parc,
      fichiers: [
        { name: 'flash/hotspot/login.html', sizeBytes: 4360, lastModified: '2026-07-02 14:04:23' },
        { name: 'flash/hotspot/logout.html', sizeBytes: 2629, lastModified: '2026-07-02 14:04:23' },
      ],
      reglages: { portailUrl: 'http://192.168.88.135:5173' },
    });

    expect((await s.etat('r1')).sante.ruptures.join(' ')).toMatch(/jamais été publiée/);
  });

  it('ne crie pas au loup sur une page posée à la main', async () => {
    // Le cas de ce parc : la page a été glissée dans WinBox, seul chemin
    // praticable pour une page riche -- l'API du routeur refuse tout octet
    // au-dessus de 127. Annoncer « vos clients n'ont pas de bouton » serait
    // faux, en rouge, sur l'écran du matin.
    const { service: s } = service({
      ...parc,
      fichiers: [
        { name: 'flash/hotspot/login.html', sizeBytes: 18308, lastModified: '2026-09-21 20:14:01' },
        { name: 'flash/hotspot/logout.html', sizeBytes: 2629, lastModified: '2026-07-02 14:04:23' },
      ],
      reglages: { portailUrl: 'http://192.168.88.135:5173' },
    });

    const { sante, avertissements } = await s.etat('r1');

    expect(sante.ruptures.join(' ')).not.toMatch(/jamais/);
    expect(avertissements.join(' ')).toMatch(/en dehors de la console/);
  });

  it('voit l’absence de puce Mobile Money', async () => {
    // La page de paiement montrerait les prix, puis un écran sans numéro : le
    // client a traversé deux pages pour rien.
    const { service: s } = service({
      ...parc,
      puces: 0,
      reglages: { portailUrl: 'http://192.168.88.135:5173' },
      publications: [
        {
          chemin: 'flash/hotspot/login.html',
          octets: 9404,
          portailUrl: 'http://192.168.88.135:5173',
          publieLe: new Date(),
        },
      ],
    });

    expect((await s.etat('r1')).sante.ruptures.join(' ')).toMatch(/aucun numéro/i);
  });

  it('voit l’adresse refusée par le Walled Garden', async () => {
    // RouterOS rejette avec un TCP reset : le navigateur du client affiche
    // « connexion refusée », un message qui ne parle jamais du Walled Garden.
    const { service: s } = service({
      ...parc,
      wgAdresses: [
        { dstAddress: '192.168.88.250', dstPort: '5173', action: 'accept', disabled: false },
      ],
      reglages: { portailUrl: 'http://192.168.88.135:5173' },
      publications: [
        {
          chemin: 'flash/hotspot/login.html',
          octets: 9404,
          portailUrl: 'http://192.168.88.135:5173',
          publieLe: new Date(),
        },
      ],
    });

    expect((await s.etat('r1')).sante.ruptures.join(' ')).toMatch(/Walled Garden/);
  });
});

describe('les tarifs choisis', () => {
  it('retire de l’affiche l’offre masquée, et elle seule', async () => {
    // Dix lignes sur un téléphone noient celle qu'on cherche. Masquer retire
    // de l'affiche, jamais de la vente : l'offre reste achetable sur la page
    // de paiement, et c'est ce que dit l'écran.
    const { service: s } = service({
      reglages: { portailUrl: 'http://10.0.0.2:5173', tarifsMasques: ['p2', 'p4'] },
    });

    const { contenu } = await s.apercu();

    expect(contenu).toContain('500 MGA');
    expect(contenu).not.toContain('1 000 MGA');
    expect(contenu).not.toContain('25 000 MGA');
  });

  it('porte le titre choisi', async () => {
    const { service: s } = service({
      reglages: { portailUrl: 'http://10.0.0.2:5173', titreTarifs: 'SARANY (Tarifs)' },
    });

    const { contenu } = await s.apercu();

    expect(contenu).toContain('SARANY (Tarifs)');
  });

  it('dit à l’écran ce qui est montré et ce qui ne l’est pas', async () => {
    const { service: s } = service({
      serveurs: [{ name: 'hs1', profileName: 'p', disabled: false }],
      profils: [profil('p', 'hotspot')],
      reglages: { portailUrl: 'http://192.168.88.135:5173', tarifsMasques: ['p2'] },
    });

    const { tarifs } = await s.etat('r1');

    expect(tarifs.find((t) => t.id === 'p1')?.visible).toBe(true);
    expect(tarifs.find((t) => t.id === 'p2')?.visible).toBe(false);
    expect(tarifs.find((t) => t.id === 'p1')?.duree).toBe('2 h');
  });
});

describe('les adresses proposées', () => {
  it('ne garde que celles du réseau du portail', async () => {
    // Un poste de travail porte des cartes virtuelles -- Hyper-V, WSL --
    // injoignables depuis le Wi-Fi. Les proposer enverrait l'exploitant
    // publier une adresse que ses clients ne peuvent pas atteindre.
    expect(memeReseau24('192.168.88.135', '192.168.88.1')).toBe(true);
    expect(memeReseau24('172.20.128.1', '192.168.88.1')).toBe(false);
    expect(memeReseau24('pas-une-adresse', '192.168.88.1')).toBe(false);
  });

  it('propose le domaine de l’exploitant', async () => {
    const { service: s } = service({
      serveurs: [{ name: 'hs1', profileName: 'p', disabled: false }],
      profils: [profil('p', 'hotspot')],
      reglages: { portailUrl: 'http://192.168.88.135:5173' },
    });

    const { adresses } = await s.etat('r1');

    expect(adresses.some((a) => a.url === 'http://wifitati.net')).toBe(true);
  });

  it('ne propose pas le nom du portail lui-même', async () => {
    // `wifitati.net` est a la fois le domaine de cet exploitant et le
    // `dns-name` de son profil HotSpot. Le proposer puis le refuser est une
    // facon de faire perdre son temps a quelqu'un.
    const { service: s } = service({
      serveurs: [{ name: 'hs1', profileName: 'p', disabled: false }],
      profils: [profil('p', 'hotspot', { dnsName: 'wifitati.net' })],
      reglages: { portailUrl: 'http://192.168.88.135:5173' },
    });

    const { adresses } = await s.etat('r1');

    expect(adresses.some((a) => a.url.includes('wifitati.net'))).toBe(false);
  });
});

describe('le logo', () => {
  it('accepte une image embarquée et l’affiche', async () => {
    // Elle voyage dans la page : elle s'affiche sans réseau, donc sans
    // dépendre du Walled Garden. C'est la seule forme tenable pour une page
    // qui ne doit avoir aucun mode de panne.
    const image = 'data:image/png;base64,iVBORw0KGgo=';
    const { service: s } = service({
      reglages: { portailUrl: 'http://10.0.0.2:5173', logoUrl: image },
    });

    const { contenu } = await s.apercu();

    expect(contenu).toContain('class="logo"');
    expect(contenu).toContain('iVBORw0KGgo=');
  });

  it('refuse ce qui n’est ni une adresse ni une image', () => {
    expect(() => exigerLogoUtilisable('javascript:alert(1)')).toThrow();
    expect(() => exigerLogoUtilisable('data:text/html;base64,PHNjcmlwdD4=')).toThrow();
  });

  it('refuse une image trop lourde pour la page', () => {
    // Le routeur refuse une page de plus de 61 440 octets : une photo
    // embarquée la ferait dépasser, et l'échec ne surviendrait qu'à la
    // publication, après tous les réglages.
    const lourde = 'data:image/png;base64,' + 'A'.repeat(40_001);

    expect(() => exigerLogoUtilisable(lourde)).toThrow(/trop lourde/);
  });

  it('laisse passer une adresse http', () => {
    expect(() => exigerLogoUtilisable('https://exemple.mg/logo.png')).not.toThrow();
  });
});

describe('la couleur d’accent', () => {
  it('refuse une teinte qui rendrait le bouton illisible', () => {
    // Elle porte du texte blanc, et cette page se lit au soleil sur un
    // téléphone. Un jaune de marque choisi de bonne foi rendrait « Se
    // connecter » invisible.
    expect(() => exigerCouleurLisible('#ffe066')).toThrow(/illisible/);
    expect(contrasteAvecBlanc('#ffe066')).toBeLessThan(3);
  });

  it('accepte le bleu par défaut', () => {
    expect(() => exigerCouleurLisible('#0284c7')).not.toThrow();
  });

  it('refuse ce qui n’est pas une couleur', () => {
    expect(() => exigerCouleurLisible('bleu')).toThrow(/#RRGGBB/);
  });
});

describe('le Walled Garden', () => {
  const ip = (adresse: string, port: string | null) => ({
    dstAddress: adresse,
    dstPort: port,
    action: 'accept',
    disabled: false,
  });

  it('reconnait une adresse autorisee avec son port', () => {
    const v = autoriseParLeWalledGarden('http://192.168.88.135:5173', [], [
      ip('192.168.88.135', '5173'),
    ]);

    expect(v.autorise).toBe(true);
  });

  it('nomme l’adresse autorisee quand ce n’est pas la bonne', () => {
    // Le cas exact de ce parc : le Walled Garden vise 192.168.88.250, et la
    // console repond sur .135 depuis que le bail DHCP a change. Dire « ce
    // n'est pas autorise » ferait chercher ; nommer l'ecart fait trouver.
    const v = autoriseParLeWalledGarden('http://192.168.88.135:5173', [], [
      ip('192.168.88.250', '5173'),
      ip('192.168.88.250', '3000'),
    ]);

    expect(v.autorise).toBe(false);
    expect(v.voisines).toContain('192.168.88.250:5173');
  });

  it('ne compte pas une entree desactivee', () => {
    // Elle est la, elle ne sert pas : c'est le detail qui fait conclure
    // « pourtant je l'ai autorisee ».
    const v = autoriseParLeWalledGarden('http://192.168.88.135:5173', [], [
      { ...ip('192.168.88.135', '5173'), disabled: true },
    ]);

    expect(v.autorise).toBe(false);
  });

  it('accepte une regle sans port, qui couvre tous les ports', () => {
    const v = autoriseParLeWalledGarden('http://192.168.88.135:5173', [], [
      ip('192.168.88.135', null),
    ]);

    expect(v.autorise).toBe(true);
  });

  it('accepte aussi une autorisation par nom d’hote', () => {
    const v = autoriseParLeWalledGarden(
      'http://paiement.wifitati.net',
      [{ dstHost: 'paiement.wifitati.net', action: 'allow', disabled: false }],
      [],
    );

    expect(v.autorise).toBe(true);
  });
});

describe('hoteDe', () => {
  it('lit l’hôte avec ou sans protocole, sans le port', () => {
    expect(hoteDe('http://192.168.88.135:5173')).toBe('192.168.88.135');
    expect(hoteDe('WifiTati.NET')).toBe('wifitati.net');
    expect(hoteDe('n’importe quoi')).toBe('');
  });
});

/**
 * La console sur un serveur public, et non plus sur le reseau du routeur.
 *
 * Les adresses candidates se deduisaient des cartes reseau de la machine,
 * gardees quand elles partageaient le /24 du portail. Sur un VPS aucune ne
 * correspond : la liste etait vide, `adresseActuelle` valait `null`, et la
 * reparation refusait avec << aucune adresse n'a pu etre deduite >>. Le
 * parcours d'achat n'etait donc reparable que depuis un serveur pose a cote
 * du routeur -- c'est-a-dire nulle part, depuis le passage sur OVH.
 */
describe('la console publique', () => {
  it("fait foi sur l'adresse locale", async () => {
    const { service: s } = service({
      serveurs: [{ name: 'hs1', profileName: 'default', disabled: false }],
      profils: [profil('default', 'hotspot')],
      basePublique: 'https://gemikrot.duckdns.org/api',
      ...OK,
    });

    const etat = await s.etat('r1');

    // L'origine, sans le `/api` : le client captif va sur la page de
    // paiement, pas sur l'API.
    expect(etat.sante.adresseActuelle).toBe('https://gemikrot.duckdns.org');
    expect(etat.adresses[0].source).toBe('console-publique');
  });

  it("retombe sur l'adresse locale quand aucune adresse publique n'est reglee", async () => {
    const { service: s } = service({
      serveurs: [{ name: 'hs1', profileName: 'default', disabled: false }],
      profils: [profil('default', 'hotspot', { hotspotAddress: '192.168.88.1' })],
      ...OK,
    });

    // Sans port : `etat` ne le devine pas, il lui est passe par l'ecran.
    expect((await s.etat('r1')).sante.adresseActuelle).toBe('http://192.168.88.135');
  });

  it('autorise un nom par la table des hotes, et non par celle des adresses', async () => {
    const { service: s, mikrotik } = service({
      serveurs: [{ name: 'hs1', profileName: 'default', disabled: false }],
      profils: [profil('default', 'hotspot')],
      basePublique: 'https://gemikrot.duckdns.org/api',
      // Rien d'autorise : la reparation doit poser l'entree elle-meme.
      wgAdresses: [],
      ...OK,
    });

    await s.reparer('admin-1', 'r1');

    // `walled-garden ip` n'accepte que des adresses : son champ est valide
    // comme tel, et la reparation echouait en rejetant le nom du serveur.
    expect(mikrotik.createWalledGardenIpEntry).not.toHaveBeenCalled();
    expect(mikrotik.createWalledGardenEntry).toHaveBeenCalledWith(
      expect.objectContaining({ dstHost: 'gemikrot.duckdns.org', action: 'allow' }),
    );
  });

  it('autorise une adresse par la table des adresses', async () => {
    const { service: s, mikrotik } = service({
      serveurs: [{ name: 'hs1', profileName: 'default', disabled: false }],
      profils: [profil('default', 'hotspot', { hotspotAddress: '192.168.88.1' })],
      wgAdresses: [],
      ...OK,
    });

    await s.reparer('admin-1', 'r1');

    expect(mikrotik.createWalledGardenEntry).not.toHaveBeenCalled();
    // Sans port : `reparer` appelle `etat` sans lui passer celui de la
    // console, donc l'adresse deduite n'en porte pas. L'entree ouvre alors
    // tous les ports de cette machine -- large, mais c'est un poste du
    // reseau local, et cela vaut mieux qu'une page de paiement fermee.
    expect(mikrotik.createWalledGardenIpEntry).toHaveBeenCalledWith(
      expect.objectContaining({ dstAddress: '192.168.88.135', action: 'accept' }),
    );
  });
});

describe('estAdresseIPv4', () => {
  it('distingue une adresse d’un nom', () => {
    expect(estAdresseIPv4('192.168.88.135')).toBe(true);
    expect(estAdresseIPv4('10.88.0.2')).toBe(true);
    expect(estAdresseIPv4('gemikrot.duckdns.org')).toBe(false);
    expect(estAdresseIPv4('192.168.88')).toBe(false);
    // 999 n'est pas un octet : le laisser passer enverrait un nom dans le
    // champ d'adresse, ou RouterOS refuserait sans que la console sache.
    expect(estAdresseIPv4('192.168.88.999')).toBe(false);
  });
});
