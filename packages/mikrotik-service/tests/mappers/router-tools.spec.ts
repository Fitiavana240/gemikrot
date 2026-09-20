import {
  mapArpEntry,
  mapIpCloud,
  mapIpService,
  mapNetworkInterfaceStats,
  mapRouterLogEntry,
  mapRouterScript,
  mapEthernetPort,
  mapCertificate,
  mapRouterSchedule,
  mapSimpleQueue,
  splitPaire,
} from '../../src/mappers/router-tools.mapper';

/**
 * Charges utiles **relevées sur le hAP ac² en RouterOS 7.24.4**, le
 * 2026-09-20. Recopiées champ pour champ.
 */

describe('mapSimpleQueue', () => {
  const RELEVE = {
    '.id': '*1',
    name: '<hotspot-PapaDuran-2>',
    target: '192.168.88.54/32',
    'max-limit': '6000000/4000000',
    'limit-at': '6000000/4000000',
    'burst-limit': '0/0',
    rate: '344136/792216',
    bytes: '1776097/4270013',
    packets: '5059/5602',
    dropped: '0/320',
    dynamic: 'true',
    disabled: 'false',
    priority: '8/8',
    queue: 'default-small/default-small',
  };

  it('découpe les paires dans le bon sens', () => {
    // Le premier terme est ce que la cible ENVOIE, le second ce qu'elle
    // REÇOIT. Une inversion afficherait le débit descendant à la place du
    // montant, et personne ne s'en apercevrait avant une plainte client.
    const file = mapSimpleQueue(RELEVE);
    expect(file.maxLimit).toEqual({ montant: 6_000_000, descendant: 4_000_000 });
    expect(file.rate).toEqual({ montant: 344_136, descendant: 792_216 });
    expect(file.dropped).toEqual({ montant: 0, descendant: 320 });
  });

  it('reconnaît une file créée par le HotSpot', () => {
    // Elles disparaissent à la déconnexion : les modifier n'a pas de sens,
    // elles se refont à la session suivante.
    expect(mapSimpleQueue(RELEVE).dynamic).toBe(true);
    expect(mapSimpleQueue(RELEVE).name).toBe('<hotspot-PapaDuran-2>');
  });

  it('rend une paire à zéro plutôt que des valeurs absentes', () => {
    expect(splitPaire(undefined)).toEqual({ montant: 0, descendant: 0 });
    expect(splitPaire('0/0')).toEqual({ montant: 0, descendant: 0 });
  });
});

describe('mapRouterLogEntry', () => {
  const RELEVE = {
    '.id': '*8D6',
    'extra-info': '',
    message:
      'gemikrot: [peer1] Handshake for peer did not complete after 5 seconds, retrying (try 2)',
    time: '2026-09-20 13:04:56',
    topics: 'wireguard,info',
  };

  it('découpe les sujets', () => {
    expect(mapRouterLogEntry(RELEVE).topics).toEqual(['wireguard', 'info']);
  });

  it("signale les lignes qui méritent l'attention", () => {
    expect(mapRouterLogEntry(RELEVE).isProblem).toBe(false);
    expect(mapRouterLogEntry({ ...RELEVE, topics: 'system,error' }).isProblem).toBe(true);
    expect(mapRouterLogEntry({ ...RELEVE, topics: 'dhcp,warning' }).isProblem).toBe(true);
  });

  it("n'avale pas le complément d'information", () => {
    // `extra-info` porte parfois la seule explication d'un incident : le
    // perdre revient à tronquer le message.
    const avec = mapRouterLogEntry({ ...RELEVE, 'extra-info': 'interface ether1' });
    expect(avec.message).toContain('interface ether1');
  });
});

describe('mapNetworkInterfaceStats', () => {
  const RELEVE = {
    '.id': '*1',
    name: 'ether1-WAN-Starlink',
    type: 'ether',
    running: 'true',
    disabled: 'false',
    'rx-byte': '49648160744',
    'tx-byte': '3438079151',
    'rx-error': '0',
    'link-downs': '6',
    'last-link-up-time': '2026-09-20 11:12:30',
    'mac-address': 'B8:69:F4:BF:B8:7D',
    mtu: '1500',
  };

  it('compte les coupures du lien', () => {
    // Un compteur qui grimpe sur le lien montant explique des plaintes que
    // rien d'autre n'explique.
    expect(mapNetworkInterfaceStats(RELEVE).linkDowns).toBe(6);
    expect(mapNetworkInterfaceStats(RELEVE).lastLinkUpTime).toBe('2026-09-20 11:12:30');
  });

  it('lit le trafic sans perdre de précision sur de grands nombres', () => {
    const iface = mapNetworkInterfaceStats(RELEVE);
    expect(iface.rxBytes).toBe(49_648_160_744);
    expect(iface.txBytes).toBe(3_438_079_151);
  });
});

describe('mapIpService', () => {
  it('distingue « toutes les adresses » de « aucune »', () => {
    // Un champ vide autorise TOUT le monde. Le rendre comme une restriction
    // ferait croire l'accès fermé alors qu'il est grand ouvert — et c'est la
    // confusion qui a coupé l'accès à ce projet une fois.
    expect(mapIpService({ '.id': '*1', name: 'winbox', port: '8291' }).availableFrom).toEqual([]);
    expect(
      mapIpService({ '.id': '*7', name: 'www-ssl', 'available-from': '192.168.88.0/24,10.88.0.1/32' })
        .availableFrom,
    ).toEqual(['192.168.88.0/24', '10.88.0.1/32']);
  });

  it('lit le port et le certificat', () => {
    const svc = mapIpService({
      '.id': '*7',
      name: 'www-ssl',
      port: '443',
      proto: 'tcp',
      certificate: 'wifitati-api-cert',
      'max-sessions': '20',
      disabled: 'false',
    });
    expect(svc.port).toBe(443);
    expect(svc.certificate).toBe('wifitati-api-cert');
    expect(svc.maxSessions).toBe(20);
  });
});

describe('mapIpCloud', () => {
  const RELEVE = {
    'back-to-home-vpn': 'revoked-and-disabled',
    'ddns-enabled': 'auto',
    'ddns-update-interval': 'none',
    'update-time': 'true',
  };

  it("dit qu'aucun nom n'est attribué plutôt que d'afficher un blanc", () => {
    // Le champ `dns-name` est absent tant que le service n'a rien attribué.
    expect(mapIpCloud(RELEVE).dnsName).toBeNull();
    expect(mapIpCloud({ ...RELEVE, 'dns-name': 'abc.sn.mynetname.net' }).dnsName).toBe(
      'abc.sn.mynetname.net',
    );
  });

  it("garde l'état tel quel : ce n'est pas un booléen", () => {
    // `auto` n'est ni oui ni non — le ramener à un booléen perdrait la
    // distinction entre « activé » et « activé si possible ».
    expect(mapIpCloud(RELEVE).ddnsEnabled).toBe('auto');
  });
});

describe('mapArpEntry', () => {
  it('distingue une entrée apprise d\'une entrée posée à la main', () => {
    const arp = mapArpEntry({
      '.id': '*1',
      address: '192.168.88.254',
      complete: 'true',
      dhcp: 'false',
      dynamic: 'true',
      interface: 'HOTSPOT',
      'mac-address': '6C:D7:1F:A2:5A:81',
      status: 'reachable',
    });
    expect(arp.dynamic).toBe(true);
    expect(arp.fromDhcp).toBe(false);
    expect(arp.complete).toBe(true);
    expect(arp.status).toBe('reachable');
  });
});

/**
 * Relevé exact du hAP en 7.24.4, `GET /rest/system/script`. Le seul script du
 * parc, jamais exécuté, et porteur d'autorisations d'administration complètes.
 */
const SCRIPT = {
  '.id': '*1',
  'dont-require-permissions': 'false',
  invalid: 'false',
  name: 'gen-4heure',
  owner: 'admin',
  policy: 'ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon',
  'run-count': '0',
  source: ':put "bonjour"',
};

describe('mapRouterScript', () => {
  it('éclate la politique en liste', () => {
    expect(mapRouterScript(SCRIPT).policy).toContain('write');
    expect(mapRouterScript(SCRIPT).policy).toContain('password');
    expect(mapRouterScript(SCRIPT).policy).toHaveLength(10);
  });

  it('rend zéro exécution comme un nombre, pas comme la chaîne « 0 »', () => {
    // La différence compte : `'0'` est vrai en JavaScript, et l'interface
    // afficherait « exécuté 0 fois » comme s'il avait déjà tourné.
    expect(mapRouterScript(SCRIPT).runCount).toBe(0);
  });

  it('lit le drapeau qui inverse les autorisations', () => {
    expect(mapRouterScript(SCRIPT).dontRequirePermissions).toBe(false);
    expect(
      mapRouterScript({ ...SCRIPT, 'dont-require-permissions': 'true' }).dontRequirePermissions,
    ).toBe(true);
  });

  it('ne casse pas sur un script sans politique', () => {
    expect(mapRouterScript({ '.id': '*2', name: 'vide' }).policy).toEqual([]);
  });
});

describe('mapRouterSchedule', () => {
  it('lit un intervalle en secondes', () => {
    const t = mapRouterSchedule({
      '.id': '*1',
      name: 'nuit',
      'on-event': 'gen-4heure',
      interval: '1d00:00:00',
      'run-count': '4',
      policy: 'read,write',
    });
    expect(t.intervalSeconds).toBe(86_400);
    expect(t.onEvent).toBe('gen-4heure');
    expect(t.runCount).toBe(4);
  });

  it('rend `null` pour une exécution unique, pas zéro', () => {
    // RouterOS écrit `00:00:00` pour « une seule fois ». Le laisser passer
    // ferait annoncer « toutes les 0 s » à l'écran.
    expect(mapRouterSchedule({ '.id': '*1', interval: '00:00:00' }).intervalSeconds).toBeNull();
    expect(mapRouterSchedule({ '.id': '*1' }).intervalSeconds).toBeNull();
  });
});

/**
 * Relevé exact d'ether3 sur le hAP : le port négocié en demi-duplex, avec
 * 378 048 collisions, parce que `100M-baseT-full` a été retiré de sa liste.
 */
const ETHER3 = {
  '.id': '*3',
  name: 'ether3',
  running: 'true',
  disabled: 'false',
  'auto-negotiation': 'true',
  advertise: '10M-baseT-half,10M-baseT-full,100M-baseT-half,1G-baseT-half,1G-baseT-full',
  'tx-collision': '378048',
  'rx-fragment': '63301',
  'rx-fcs-error': '0',
  'rx-bytes': '396207599',
  'tx-bytes': '9012345678',
};

const MONITOR3 = {
  name: 'ether3',
  status: 'link-ok',
  rate: '100Mbps',
  'full-duplex': 'false',
  'link-partner-advertising': '10M-baseT-half,10M-baseT-full,100M-baseT-half,100M-baseT-full',
};

describe('mapEthernetPort', () => {
  it('prend le duplex dans le monitor, absent de la configuration', () => {
    expect(mapEthernetPort(ETHER3, MONITOR3).fullDuplex).toBe(false);
    expect(mapEthernetPort(ETHER3, MONITOR3).rate).toBe('100Mbps');
  });

  it('rend le duplex `null` sans lien, et non `false`', () => {
    // Trois états, pas deux : un port débranché n'a pas de duplex, et le
    // ramener à `false` le ferait passer pour une anomalie à l'écran.
    const sansLien = mapEthernetPort(
      { '.id': '*4', name: 'ether4', running: 'false' },
      { name: 'ether4', status: 'no-link' },
    );
    expect(sansLien.fullDuplex).toBeNull();
    expect(sansLien.rate).toBeNull();
    expect(sansLien.status).toBe('no-link');
  });

  it('garde les deux listes annoncées, qui portent la cause de la panne', () => {
    const p = mapEthernetPort(ETHER3, MONITOR3);
    expect(p.advertise).not.toContain('100M-baseT-full');
    expect(p.partnerAdvertise).toContain('100M-baseT-full');
    expect(p.collisions).toBe(378_048);
    expect(p.fragments).toBe(63_301);
  });

  it('reste lisible quand le monitor a échoué', () => {
    // Le `monitor` est un appel séparé : s'il tombe, la configuration seule
    // doit continuer de rendre un port, pas faire échouer tout l'écran.
    const p = mapEthernetPort(ETHER3);
    expect(p.name).toBe('ether3');
    expect(p.status).toBe('link-ok');
    expect(p.fullDuplex).toBeNull();
    expect(p.partnerAdvertise).toEqual([]);
  });
});

/** Relevé exact du certificat qui sert l'API REST sur le hAP. */
const CERT = {
  '.id': '*1',
  name: 'wifitati-api-cert',
  'common-name': '192.168.88.1',
  'subject-alt-name': '',
  authority: 'true',
  issued: 'false',
  'private-key': 'true',
  fingerprint: '50c8d4f2be234675000e4b1b5eea2a5b23fdeb7e8dac381c3b66218a6f6ae0b9',
  'key-type': 'rsa',
  'key-size': '2048',
  'invalid-before': '2026-09-18 17:00:17',
  'invalid-after': '2036-09-15 17:00:17',
  'expires-after': '521w16h1m7s',
};

describe('mapCertificate', () => {
  it('reconnaît un certificat auto-signé', () => {
    // `authority` seul ne suffit pas : une autorité importée le porte aussi.
    // C'est `issued` faux qui dit que le certificat s'est signé lui-même.
    expect(mapCertificate(CERT).selfSigned).toBe(true);
    expect(mapCertificate({ ...CERT, issued: 'true' }).selfSigned).toBe(false);
  });

  it('rend une liste vide quand aucun nom alternatif n’est déclaré', () => {
    // C'est ce vide qui oblige à désactiver la vérification TLS : le
    // distinguer d'une liste à un élément est tout l'intérêt du champ.
    expect(mapCertificate(CERT).subjectAltNames).toEqual([]);
    expect(
      mapCertificate({ ...CERT, 'subject-alt-name': 'IP:10.88.0.2,DNS:routeur' })
        .subjectAltNames,
    ).toEqual(['IP:10.88.0.2', 'DNS:routeur']);
  });

  it('lit le temps restant depuis la durée du routeur', () => {
    const restant = mapCertificate(CERT).expiresInSeconds!;
    // 521 semaines ≈ 10 ans.
    expect(restant).toBeGreaterThan(9 * 365 * 86_400);
    expect(mapCertificate(CERT).keySizeBits).toBe(2048);
  });
});
