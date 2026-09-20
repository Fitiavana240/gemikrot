import {
  mapArpEntry,
  mapIpCloud,
  mapIpService,
  mapNetworkInterfaceStats,
  mapRouterLogEntry,
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
