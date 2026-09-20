import {
  mapDnsSettings,
  mapDnsStaticEntry,
  mapFirewallRule,
  mapRoute,
} from '../../src/mappers/router-tools.mapper';

/**
 * Charges utiles **relevées sur le hAP ac² en RouterOS 7.24.4**, le
 * 2026-09-20. Recopiées champ pour champ, y compris les champs absents :
 * RouterOS n'écrit pas ce qui est vide, et une règle de pare-feu réelle
 * n'a presque jamais tous ses champs.
 */

describe('mapFirewallRule', () => {
  // La première règle de la chaîne `forward`, posée par le HotSpot.
  const SAUT_HOTSPOT = {
    '.id': '*E',
    action: 'jump',
    bytes: '6045591',
    chain: 'forward',
    dynamic: 'true',
    hotspot: 'from-client,!auth',
    invalid: 'false',
    'jump-target': 'hs-unauth',
    packets: '17697',
  };

  it("déduit la position de l'ordre de lecture", () => {
    // RouterOS ne renvoie aucun numéro : c'est l'ordre qui fait la loi, la
    // première règle qui correspond décide. Perdre cette information rendrait
    // la table illisible — deux règles identiques placées différemment font
    // l'inverse l'une de l'autre.
    expect(mapFirewallRule(SAUT_HOTSPOT, 0).position).toBe(0);
    expect(mapFirewallRule(SAUT_HOTSPOT, 7).position).toBe(7);
  });

  it('reconnaît une règle posée par le HotSpot', () => {
    const regle = mapFirewallRule(SAUT_HOTSPOT, 0);

    // Ces règles se refont toutes seules : les signaler évite qu'on cherche
    // à les corriger à la main.
    expect(regle.hotspot).toBe('from-client,!auth');
    expect(regle.dynamic).toBe(true);
    expect(regle.chain).toBe('forward');
    expect(regle.action).toBe('jump');
    expect(regle.jumpTarget).toBe('hs-unauth');
    expect(regle.bytes).toBe(6045591);
    expect(regle.packets).toBe(17697);
  });

  it('rend null les champs que RouterOS a omis, sans inventer', () => {
    const regle = mapFirewallRule(SAUT_HOTSPOT, 0);

    expect(regle.srcAddress).toBeNull();
    expect(regle.dstAddress).toBeNull();
    expect(regle.protocol).toBeNull();
    expect(regle.comment).toBeNull();
    // `disabled` est absent de ce relevé : absent veut dire actif.
    expect(regle.disabled).toBe(false);
  });

  it('lit une règle de masquage, avec son préfixe de journal vide', () => {
    const MASQUERADE = {
      '.id': '*14',
      action: 'masquerade',
      bytes: '43075513',
      chain: 'srcnat',
      disabled: 'false',
      dynamic: 'false',
      invalid: 'false',
      log: 'false',
      'log-prefix': '',
      'out-interface': 'ether1-WAN-Starlink',
      packets: '165728',
    };

    const regle = mapFirewallRule(MASQUERADE, 3);

    expect(regle.action).toBe('masquerade');
    expect(regle.outInterface).toBe('ether1-WAN-Starlink');
    expect(regle.dynamic).toBe(false);
    expect(regle.log).toBe(false);
    // Chaîne vide, pas chaîne vide affichée : `""` devient `null`.
    expect(regle.logPrefix).toBeNull();
  });

  it('garde le commentaire des règles laissées en place par la configuration', () => {
    const regle = mapFirewallRule(
      {
        '.id': '*D',
        action: 'passthrough',
        bytes: '0',
        chain: 'unused-hs-chain',
        comment: 'place hotspot rules here',
        disabled: 'true',
        dynamic: 'false',
        invalid: 'false',
        packets: '0',
      },
      15,
    );

    expect(regle.disabled).toBe(true);
    expect(regle.comment).toBe('place hotspot rules here');
  });
});

describe('mapDnsSettings', () => {
  const RELEVE = {
    'allow-remote-requests': 'false',
    'cache-max-ttl': '1w',
    'cache-size': '2048',
    'cache-used': '232',
    'dynamic-servers': '192.168.1.1',
    'max-concurrent-queries': '100',
    servers: '8.8.8.8,1.1.1.1',
    'use-doh-server': '',
    'verify-doh-cert': 'false',
    vrf: 'main',
  };

  it('découpe la liste de serveurs', () => {
    const dns = mapDnsSettings(RELEVE);

    expect(dns.servers).toEqual(['8.8.8.8', '1.1.1.1']);
    // Ceux reçus du fournisseur sont distincts de ceux saisis à la main :
    // les mélanger cacherait d'où vient la résolution.
    expect(dns.dynamicServers).toEqual(['192.168.1.1']);
  });

  it('rend une liste vide plutôt une liste contenant du vide', () => {
    expect(mapDnsSettings({ servers: '' }).servers).toEqual([]);
    expect(mapDnsSettings({}).servers).toEqual([]);
  });

  it('lit le cache comme un nombre de Kio', () => {
    // RouterOS rend `"2048"` et non `"2048KiB"` sur cette version : le
    // vérifier ici évite d'écrire « 2048KiB Kio » à l'écran.
    const dns = mapDnsSettings(RELEVE);

    expect(dns.cacheSize).toBe(2048);
    expect(dns.cacheUsed).toBe(232);
  });

  it('ne signale pas un DoH qui n\'est pas configuré', () => {
    expect(mapDnsSettings(RELEVE).useDohServer).toBeNull();
  });

  it('lit `allow-remote-requests` sans en tirer de conclusion', () => {
    // Ce routeur est à `false` et sert pourtant 646 comptes HotSpot : le
    // portail intercepte le DNS lui-même. Le mapper rapporte, il ne juge pas.
    expect(mapDnsSettings(RELEVE).allowRemoteRequests).toBe(false);
  });
});

describe('mapDnsStaticEntry', () => {
  it('convertit le TTL, qui est une durée et non des secondes', () => {
    const entree = mapDnsStaticEntry({
      '.id': '*2',
      address: '192.168.88.1',
      disabled: 'false',
      dynamic: 'false',
      name: 'wifitati.local',
      ttl: '1d',
      type: 'A',
    });

    expect(entree.name).toBe('wifitati.local');
    expect(entree.ttlSeconds).toBe(86400);
    expect(entree.dynamic).toBe(false);
  });

  it('distingue une entrée dynamique, que le HotSpot a posée', () => {
    const entree = mapDnsStaticEntry({
      '.id': '*3',
      address: '192.168.88.1',
      disabled: 'false',
      dynamic: 'true',
      name: 'wifitati.net',
      ttl: '5m',
      type: 'A',
    });

    expect(entree.dynamic).toBe(true);
    expect(entree.ttlSeconds).toBe(300);
  });
});

describe('mapRoute', () => {
  it('lit la route par défaut reçue par DHCP', () => {
    const route = mapRoute({
      '.id': '*80000004',
      active: 'true',
      dhcp: 'true',
      distance: '1',
      'dst-address': '0.0.0.0/0',
      dynamic: 'true',
      gateway: '192.168.1.1',
      'immediate-gw': '192.168.1.1%ether1-WAN-Starlink',
      inactive: 'false',
      'routing-table': 'main',
      scope: '30',
      'target-scope': '10',
      'vrf-interface': 'ether1-WAN-Starlink',
    });

    expect(route.dstAddress).toBe('0.0.0.0/0');
    expect(route.gateway).toBe('192.168.1.1');
    // La passerelle retenue porte l'interface : c'est elle qui dit par où
    // sort réellement le trafic.
    expect(route.immediateGw).toBe('192.168.1.1%ether1-WAN-Starlink');
    expect(route.active).toBe(true);
    expect(route.dhcp).toBe(true);
    expect(route.isStatic).toBe(false);
    expect(route.distance).toBe(1);
  });

  it('lit une route connectée, déduite d\'une adresse du routeur', () => {
    const route = mapRoute({
      '.id': '*201C5010',
      active: 'true',
      connect: 'true',
      distance: '0',
      'dst-address': '192.168.88.0/24',
      dynamic: 'true',
      gateway: 'HOTSPOT',
      'immediate-gw': 'HOTSPOT',
      'local-address': '192.168.88.1%HOTSPOT',
      'routing-table': 'main',
      scope: '10',
      'target-scope': '5',
    });

    expect(route.connect).toBe(true);
    expect(route.gateway).toBe('HOTSPOT');
    expect(route.distance).toBe(0);
    // `static` est réservé en TypeScript : le champ est renommé, et c'est
    // exactement le genre de renommage silencieux qui mérite un test.
    expect(route.isStatic).toBe(false);
  });
});
