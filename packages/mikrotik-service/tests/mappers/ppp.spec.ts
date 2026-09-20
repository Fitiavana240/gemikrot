import {
  mapIpPool,
  mapPppActive,
  mapPppProfile,
  mapPppSecret,
  mapPppoeServer,
} from '../../src/mappers/ppp.mapper';

/**
 * Charges utiles **relevées sur le hAP ac² en RouterOS 7.24.4**, le
 * 2026-09-20, par `scripts/probe-ppp-sonde.ts` — le parc ne vendant pas de
 * PPPoE, les objets ont été créés le temps du relevé puis supprimés.
 *
 * Elles sont recopiées telles quelles, champ pour champ. Quatre
 * correspondances de ce projet, écrites de bonne foi sur la documentation
 * seule, se sont révélées fausses au contact du matériel : la règle est
 * désormais de figer ici ce que le routeur a réellement répondu.
 */
const PROFIL_RELEVE = {
  '.id': '*1',
  'address-list': '',
  'bridge-learning': 'default',
  'change-tcp-mss': 'yes',
  comment: 'GeMikrot — sondage, à supprimer',
  default: 'false',
  'dns-server': '8.8.8.8',
  'local-address': '10.77.0.1',
  name: 'gemikrot-sonde-profil',
  'on-down': '',
  'on-up': '',
  'only-one': 'yes',
  'rate-limit': '2M/2M',
  'remote-address': 'gemikrot-sonde-pool',
  'use-compression': 'default',
  'use-encryption': 'default',
  'use-ipv6': 'yes',
  'use-mpls': 'default',
  'use-upnp': 'default',
};

const COMPTE_RELEVE = {
  '.id': '*1',
  'caller-id': '',
  comment: 'GeMikrot — sondage, à supprimer',
  disabled: 'false',
  'ipv6-routes': '',
  'last-logged-out': '1970-01-01 00:00:00',
  'limit-bytes-in': '0',
  'limit-bytes-out': '0',
  name: 'gemikrot-sonde-compte',
  password: '***',
  profile: 'gemikrot-sonde-profil',
  routes: '',
  service: 'pppoe',
};

const SERVEUR_RELEVE = {
  '.id': '*1',
  'accept-untagged': 'true',
  authentication: 'pap,chap,mschap1,mschap2',
  'default-profile': 'gemikrot-sonde-profil',
  disabled: 'true',
  interface: 'ether4',
  invalid: 'false',
  'keepalive-timeout': '10',
  'max-mru': 'auto',
  'max-mtu': 'auto',
  'max-sessions': 'unlimited',
  mrru: 'disabled',
  'one-session-per-host': 'true',
  'pado-delay': '0',
  'pppoe-over-vlan-range': '',
  'service-name': 'gemikrot-sonde-svc',
};

const BASSIN_RELEVE = {
  '.id': '*3',
  available: '11',
  name: 'gemikrot-sonde-pool',
  ranges: '10.77.0.10-10.77.0.20',
  total: '11',
  used: '0',
};

describe('mapPppProfile', () => {
  const profil = mapPppProfile(PROFIL_RELEVE);

  it('lit le débit dans un jeton unique, et non deux champs', () => {
    // C'est là que la confusion guette : la limitation User Manager expose
    // `rate-limit-rx` et `rate-limit-tx`, le profil PPP un seul `rate-limit`.
    expect(profil.rateLimitRxBitsPerSecond).toBe(2_000_000);
    expect(profil.rateLimitTxBitsPerSecond).toBe(2_000_000);
  });

  it("garde le nom du bassin d'adresses tel quel", () => {
    // `remote-address` accepte une adresse ou un nom de bassin ; c'est un
    // bassin dès qu'il y a plus d'un abonné.
    expect(profil.remoteAddress).toBe('gemikrot-sonde-pool');
    expect(profil.localAddress).toBe('10.77.0.1');
  });

  it('comprend les deux conventions booléennes du même objet', () => {
    // `default` répond "false", `only-one` répond "yes" — dans le même objet.
    expect(profil.isDefault).toBe(false);
    expect(profil.onlyOne).toBe(true);
  });

  it('ne rend pas « hérité » comme un booléen', () => {
    // `use-compression: "default"` ne veut dire ni oui ni non.
    expect(mapPppProfile({ ...PROFIL_RELEVE, 'only-one': 'default' }).onlyOne).toBeNull();
  });

  it('rend null un débit absent plutôt que zéro', () => {
    const sansDebit = mapPppProfile({ ...PROFIL_RELEVE, 'rate-limit': '' });
    expect(sansDebit.rateLimitRxBitsPerSecond).toBeNull();
    expect(sansDebit.rateLimitTxBitsPerSecond).toBeNull();
  });
});

describe('mapPppSecret', () => {
  const compte = mapPppSecret(COMPTE_RELEVE);

  it('ne prend pas la date sentinelle pour une vraie déconnexion', () => {
    // RouterOS écrit 1970-01-01 pour « jamais connecté », au lieu de laisser
    // le champ vide. Lue telle quelle, elle ferait passer chaque compte neuf
    // pour un abonné parti depuis cinquante ans.
    expect(compte.lastLoggedOut).toBeNull();
  });

  it('rend une vraie date de déconnexion quand il y en a une', () => {
    const parti = mapPppSecret({ ...COMPTE_RELEVE, 'last-logged-out': '2026-09-19 14:02:11' });
    expect(parti.lastLoggedOut).toBe('2026-09-19 14:02:11');
  });

  it('ne confond pas un quota nul avec une absence de quota', () => {
    expect(compte.limitBytesIn).toBeNull();
    expect(mapPppSecret({ ...COMPTE_RELEVE, 'limit-bytes-in': '1048576' }).limitBytesIn).toBe(
      1_048_576,
    );
  });

  it('rattache le compte à son profil, qui porte le débit', () => {
    expect(compte.username).toBe('gemikrot-sonde-compte');
    expect(compte.profile).toBe('gemikrot-sonde-profil');
    expect(compte.service).toBe('pppoe');
    expect(compte.disabled).toBe(false);
  });

  it('rend null les champs que RouterOS renvoie vides', () => {
    expect(compte.remoteAddress).toBeNull();
  });
});

describe('mapPppoeServer', () => {
  const serveur = mapPppoeServer(SERVEUR_RELEVE);

  it('ne transforme pas « unlimited » en NaN', () => {
    // Passé à Number, « unlimited » donne NaN, qui se propage sans bruit dans
    // tout calcul de capacité.
    expect(serveur.maxSessions).toBeNull();
    expect(mapPppoeServer({ ...SERVEUR_RELEVE, 'max-sessions': '50' }).maxSessions).toBe(50);
  });

  it("découpe les méthodes d'authentification", () => {
    expect(serveur.authentication).toEqual(['pap', 'chap', 'mschap1', 'mschap2']);
  });

  it("retient l'interface et l'état", () => {
    expect(serveur.interfaceName).toBe('ether4');
    expect(serveur.disabled).toBe(true);
    expect(serveur.oneSessionPerHost).toBe(true);
    expect(serveur.defaultProfile).toBe('gemikrot-sonde-profil');
  });
});

describe('mapIpPool', () => {
  it("compte les adresses d'un bassin", () => {
    const bassin = mapIpPool(BASSIN_RELEVE);
    expect(bassin.name).toBe('gemikrot-sonde-pool');
    expect(bassin.ranges).toBe('10.77.0.10-10.77.0.20');
    expect(bassin.total).toBe(11);
    expect(bassin.used).toBe(0);
    expect(bassin.available).toBe(11);
  });

  it('distingue un compteur absent d’un compteur à zéro', () => {
    const sansCompteurs = mapIpPool({ '.id': '*9', name: 'x', ranges: '10.0.0.1-10.0.0.9' });
    expect(sansCompteurs.total).toBeNull();
    expect(sansCompteurs.used).toBeNull();
  });
});

describe('mapPppActive', () => {
  /**
   * **Non relevée sur le matériel.** `/ppp/active` ne se remplit qu'avec un
   * client PPPoE réellement connecté, et le parc n'en a aucun ; créer des
   * objets ne peuple pas cette collection. Ces cas éprouvent donc la logique
   * de la correspondance — durées, compteurs absents — mais **pas les noms de
   * champs**, qui restent à confirmer au premier abonné réel.
   */
  it('convertit la durée de session en secondes', () => {
    expect(mapPppActive({ '.id': '*1', name: 'abonne', uptime: '1h30m' }).uptimeSeconds).toBe(5400);
  });

  it('distingue un compteur absent d’un volume nul', () => {
    const session = mapPppActive({ '.id': '*1', name: 'abonne', uptime: '5s' });
    expect(session.bytesIn).toBeNull();
    expect(session.bytesOut).toBeNull();
  });
});
