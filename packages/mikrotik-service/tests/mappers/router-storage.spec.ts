import {
  evaluerUserManager,
  mapRouterDisk,
  mapRouterStorage,
  racineDuChemin,
} from '../../src/mappers/router-storage.mapper';

/**
 * Charges utiles **relevées sur le hAP ac² en RouterOS 7.24.4**, le
 * 2026-09-20 — le routeur du parc, dont la mémoire interne est pleine et
 * dont la base User Manager vit sur une clé USB.
 */

const RESOURCE = {
  'architecture-name': 'arm',
  'board-name': 'hAP ac^2',
  'free-hdd-space': '286720',
  'free-memory': '32456704',
  'total-hdd-space': '16777216',
  'total-memory': '134217728',
  version: '7.24.4 (stable)',
};

const DISQUE_MATERIEL = {
  '.id': '*1',
  disabled: 'false',
  empty: 'false',
  fs: '-',
  interface: 'USB 2.00 480Mbps',
  model: 'USB 2.0 Flash Disk',
  mounted: 'false',
  partition: 'false',
  serial: '23b00f330f51dd',
  size: '1010826752',
  slot: 'usb1',
  type: 'hardware',
};

const DISQUE_PARTITION = {
  '.id': '*3',
  disabled: 'false',
  empty: 'false',
  fs: 'ext4',
  'mount-point': 'usb1-part1',
  model: 'USB 2.0 Flash Disk',
  mounted: 'true',
  partition: 'true',
  serial: "@512-1'010'826'752",
  size: '1010826240',
  slot: 'usb1-part1',
  type: 'partition',
};

const PAQUETS = [
  { '.id': '*1', available: 'false', disabled: 'false', name: 'routeros', size: '12295830', version: '7.24.4' },
  { '.id': '*2', available: 'false', disabled: 'false', name: 'wireless', size: '1876113', version: '7.24.4' },
  { '.id': '*3', available: 'false', disabled: 'false', name: 'user-manager', size: '344209', version: '7.24.4' },
];

const SERVICE = {
  'accounting-port': '1813',
  'authentication-port': '1812',
  certificate: 'none',
  enabled: 'true',
  'use-profiles': 'true',
};

const BASE = {
  'db-path': '/usb1-part1/user-manager',
  'db-size': '172712',
  'free-disk-space': '975499264',
};

/** L'état réel du parc, celui qui doit être déclaré sain. */
const PARC = {
  packagesRaw: PAQUETS,
  serviceRaw: SERVICE,
  databaseRaw: BASE,
  resource: RESOURCE,
  disksRaw: [DISQUE_MATERIEL, DISQUE_PARTITION],
};

const codes = (r: ReturnType<typeof evaluerUserManager>) => r.constats.map((c) => c.code);

describe('racineDuChemin', () => {
  it("ignore la barre de tête, que RouterOS met parfois et parfois pas", () => {
    // `/user-manager/database` rend `/usb1-part1/...` avec la barre, `/file`
    // rend `usb1-part1/...` sans. Les deux doivent donner la même racine,
    // sans quoi le rapprochement entre la base et son disque échoue.
    expect(racineDuChemin('/usb1-part1/user-manager')).toBe('usb1-part1');
    expect(racineDuChemin('usb1-part1/user-manager/um5.sqlite')).toBe('usb1-part1');
    expect(racineDuChemin('flash')).toBe('flash');
  });
});

describe('mapRouterDisk', () => {
  it('ne prend pas `-` pour un système de fichiers', () => {
    // Le matériel brut porte `fs: "-"`. L'afficher tel quel laisserait croire
    // à un système de fichiers nommé « - » ; `null` dit la vérité : aucun.
    expect(mapRouterDisk(DISQUE_MATERIEL).fs).toBeNull();
    expect(mapRouterDisk(DISQUE_PARTITION).fs).toBe('ext4');
  });

  it("distingue le support de sa partition, car seule la partition est montée", () => {
    const materiel = mapRouterDisk(DISQUE_MATERIEL);
    const partition = mapRouterDisk(DISQUE_PARTITION);

    // `/disk` liste les deux. Confondre les deux ferait conclure « clé non
    // montée » alors que c'est sa partition qui l'est.
    expect(materiel.isPartition).toBe(false);
    expect(materiel.mounted).toBe(false);
    expect(partition.isPartition).toBe(true);
    expect(partition.mounted).toBe(true);
    expect(partition.mountPoint).toBe('usb1-part1');
  });

  it("rend null l'espace libre, que RouterOS 7.24 ne donne pas", () => {
    // Constat de terrain : `/disk` n'a aucun champ `free`, même pour une
    // partition ext4 montée. Le chiffre fiable vient de
    // `/user-manager/database`. Le test le fige pour qu'on ne se remette pas
    // à l'attendre d'ici.
    expect(mapRouterDisk(DISQUE_PARTITION).freeBytes).toBeNull();
  });
});

describe('mapRouterStorage', () => {
  const FICHIERS = [
    { '.id': '*a', name: 'um5files', type: 'directory' },
    { '.id': '*b', name: 'flash', type: 'disk' },
    { '.id': '*c', name: 'flash/auto-before-reset.backup', size: '20292', type: 'backup' },
    { '.id': '*d', name: 'um5files/js/user.js', size: '17595', type: '.js file' },
    { '.id': '*e', name: 'usb1-part1/user-manager/um5.sqlite', size: '61440', type: '.sqlite file' },
    { '.id': '*f', name: 'usb1-part1/user-manager/um5.sqlite-wal', size: '111272', type: '.sqlite-wal file' },
  ];

  it('additionne par racine, pour dire où part la place', () => {
    const stockage = mapRouterStorage(RESOURCE, [DISQUE_PARTITION], PAQUETS, FICHIERS);

    expect(stockage.parRacine).toEqual([
      { root: 'usb1-part1', bytes: 172712, fileCount: 2 },
      { root: 'flash', bytes: 20292, fileCount: 1 },
      { root: 'um5files', bytes: 17595, fileCount: 1 },
    ]);
  });

  it('ne compte ni les dossiers ni les disques comme des fichiers', () => {
    const stockage = mapRouterStorage(RESOURCE, [], PAQUETS, FICHIERS);
    const um5 = stockage.parRacine.find((r) => r.root === 'um5files');

    // `um5files` contient une entrée dossier sans taille et un fichier :
    // compter le dossier annoncerait deux fichiers là où il y en a un.
    expect(um5?.fileCount).toBe(1);
  });

  it('rapporte la mémoire interne telle quelle', () => {
    const stockage = mapRouterStorage(RESOURCE, [], PAQUETS, []);

    expect(stockage.internalTotalBytes).toBe(16777216);
    expect(stockage.internalFreeBytes).toBe(286720);
    expect(stockage.boardName).toBe('hAP ac^2');
    expect(stockage.architecture).toBe('arm');
  });
});

describe('evaluerUserManager', () => {
  it('déclare le parc réel utilisable', () => {
    const etat = evaluerUserManager(PARC);

    expect(etat.packageInstalled).toBe(true);
    expect(etat.packageEnabled).toBe(true);
    expect(etat.serviceEnabled).toBe(true);
    expect(etat.useProfiles).toBe(true);
    expect(etat.database).toEqual({
      path: '/usb1-part1/user-manager',
      sizeBytes: 172712,
      freeBytes: 975499264,
      surSupportAmovible: true,
    });
    // Aucun bloquant : ce routeur marche, et le diagnostic doit le dire.
    expect(etat.constats.filter((c) => c.niveau === 'bloquant')).toEqual([]);
  });

  it('signale la dépendance à la clé sans la présenter comme une faute', () => {
    const etat = evaluerUserManager(PARC);
    const constat = etat.constats.find((c) => c.code === 'base-sur-support-amovible');

    // C'est le bon montage, pas une erreur — mais c'est une dépendance
    // matérielle que personne ne voit tant qu'elle tient.
    expect(constat?.niveau).toBe('ok');
    expect(constat?.detail).toContain('jamais être retirée');
  });

  it('avertit que la mémoire interne est saturée', () => {
    // 280 Kio libres sur 16 Mio : sans conséquence au quotidien, fatal le
    // jour d'une sauvegarde ou d'une mise à jour.
    expect(codes(evaluerUserManager(PARC))).toContain('flash-interne-saturee');
  });

  it("explique l'onglet manquant quand le paquet n'est pas installé", () => {
    const etat = evaluerUserManager({
      ...PARC,
      packagesRaw: PAQUETS.filter((p) => p.name !== 'user-manager'),
      // Sans le paquet, les deux lectures échouent : le service les absorbe
      // et passe `null`. C'est le cas nominal d'un routeur neuf.
      serviceRaw: null,
      databaseRaw: null,
    });

    expect(etat.packageInstalled).toBe(false);
    expect(etat.database).toBeNull();
    const constat = etat.constats.find((c) => c.code === 'paquet-absent');
    expect(constat?.niveau).toBe('bloquant');
    expect(constat?.detail).toContain("n'apparaît pas");
    // Version et architecture doivent figurer : un .npk qui ne correspond
    // pas exactement ne s'installe pas, et échoue sans le dire.
    expect(constat?.detail).toContain('7.24.4');
    expect(constat?.detail).toContain('arm');
    // Et avec 280 Kio libres, prévenir avant le téléversement, pas après.
    expect(constat?.detail).toContain('Faites de la place');
  });

  it('met la disparition du support avant tout le reste', () => {
    // Le scénario qui fait perdre des tickets déjà vendus : la clé n'est
    // plus là, mais la base est toujours déclarée dessus.
    const etat = evaluerUserManager({ ...PARC, disksRaw: [] });

    expect(etat.constats[0].code).toBe('volume-base-absent');
    expect(etat.constats[0].niveau).toBe('bloquant');
    expect(etat.constats[0].detail).toContain('illisibles');
  });

  it('traite une clé branchée mais non montée comme une clé absente', () => {
    const etat = evaluerUserManager({
      ...PARC,
      disksRaw: [DISQUE_MATERIEL, { ...DISQUE_PARTITION, mounted: 'false' }],
    });

    expect(codes(etat)).toContain('volume-base-non-monte');
    // Et surtout : pas de « tout va bien » en même temps.
    expect(codes(etat)).not.toContain('base-sur-support-amovible');
  });

  it('propose de rallumer un service éteint', () => {
    const etat = evaluerUserManager({
      ...PARC,
      serviceRaw: { ...SERVICE, enabled: 'false' },
    });

    const constat = etat.constats.find((c) => c.code === 'service-eteint');
    expect(constat?.niveau).toBe('bloquant');
    expect(constat?.commande).toBe('/user-manager/set enabled=yes');
  });

  it('signale les profils désactivés, sans quoi rien ne se vend', () => {
    const etat = evaluerUserManager({
      ...PARC,
      serviceRaw: { ...SERVICE, 'use-profiles': 'false' },
    });

    const constat = etat.constats.find((c) => c.code === 'profils-desactives');
    expect(constat?.niveau).toBe('avertissement');
    expect(constat?.commande).toBe('/user-manager/set use-profiles=yes');
  });

  it('demande un redémarrage pour un paquet désactivé', () => {
    const etat = evaluerUserManager({
      ...PARC,
      packagesRaw: PAQUETS.map((p) =>
        p.name === 'user-manager' ? { ...p, disabled: 'true' } : p,
      ),
    });

    expect(etat.packageInstalled).toBe(true);
    expect(etat.packageEnabled).toBe(false);
    const constat = etat.constats.find((c) => c.code === 'paquet-desactive');
    expect(constat?.commande).toBe('/system/package/enable user-manager');
    expect(constat?.detail).toContain('redémarrage');
  });

  it('propose de déplacer une base restée sur le flash, si une clé est là', () => {
    const etat = evaluerUserManager({
      ...PARC,
      databaseRaw: { ...BASE, 'db-path': 'flash/user-manager', 'free-disk-space': '286720' },
    });

    expect(etat.database?.surSupportAmovible).toBe(false);
    expect(codes(etat)).toContain('base-sur-flash-interne');
    // 280 Kio pour la base : elle ne peut plus grandir.
    expect(codes(etat)).toContain('base-presque-pleine');
  });

  it('ne propose pas de déplacement quand aucune clé montée n\'existe', () => {
    // Conseiller un déplacement vers un support inexistant serait pire
    // qu'inutile : cela enverrait chercher une panne ailleurs.
    const etat = evaluerUserManager({
      ...PARC,
      databaseRaw: { ...BASE, 'db-path': 'flash/user-manager' },
      disksRaw: [],
    });

    expect(codes(etat)).not.toContain('base-sur-flash-interne');
  });

  it('trie par gravité, quel que soit l\'ordre où les règles sont écrites', () => {
    const etat = evaluerUserManager({
      ...PARC,
      serviceRaw: { ...SERVICE, enabled: 'false' },
      disksRaw: [DISQUE_MATERIEL, { ...DISQUE_PARTITION, mounted: 'false' }],
    });

    const niveaux = etat.constats.map((c) => c.niveau);
    expect(niveaux).toEqual([...niveaux].sort((a, b) =>
      ({ bloquant: 0, avertissement: 1, ok: 2 })[a] - ({ bloquant: 0, avertissement: 1, ok: 2 })[b],
    ));
    expect(niveaux[0]).toBe('bloquant');
  });
});
