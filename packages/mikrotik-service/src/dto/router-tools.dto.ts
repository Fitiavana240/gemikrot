/**
 * Les tables de diagnostic et de débit que WinBox expose sous `IP`, `Queues`,
 * `Interfaces` et `Log`.
 *
 * **Lecture seule, par décision.** Les modifier suppose de comprendre ce qu'on
 * casse sur un routeur qui sert des centaines de clients ; la console montre,
 * WinBox modifie.
 *
 * Formes relevées sur un hAP ac² en RouterOS 7.24.4 le 2026-09-20, figées
 * dans `tests/mappers/router-tools.spec.ts`.
 */

/** Une paire montant/descendant, telle que RouterOS les écrit : `"6000000/4000000"`. */
export interface PaireDto {
  /** Ce que le client **envoie**. */
  montant: number;
  /** Ce que le client **reçoit**. C'est le chiffre qu'il perçoit comme « le débit ». */
  descendant: number;
}

/** Une file simple — `/queue/simple`. C'est elle qui tient le débit d'un client. */
export interface SimpleQueueDto {
  id: string;
  name: string;
  /** Adresse ou plage à laquelle la file s'applique. */
  target: string;
  /** Plafond, en bits par seconde. */
  maxLimit: PaireDto;
  /** Débit garanti, en bits par seconde. Zéro quand rien n'est garanti. */
  limitAt: PaireDto;
  /** Débit instantané, en bits par seconde. */
  rate: PaireDto;
  bytes: PaireDto;
  dropped: PaireDto;
  /**
   * Vrai quand le HotSpot l'a créée lui-même à l'ouverture d'une session.
   * Ces files-là portent un nom entre chevrons et disparaissent à la
   * déconnexion : les modifier n'a pas de sens, elles se refont.
   */
  dynamic: boolean;
  disabled: boolean;
  comment: string | null;
}

/** Une ligne du journal du routeur — `/log`. */
export interface RouterLogEntryDto {
  id: string;
  /** Tel que le routeur l'écrit, dans **son** fuseau. */
  time: string;
  /** `hotspot`, `wireguard`, `error`… plusieurs par ligne. */
  topics: string[];
  message: string;
  /** Vrai si l'un des sujets marque une erreur ou un avertissement. */
  isProblem: boolean;
}

/** Une interface réseau — `/interface`. */
export interface NetworkInterfaceStatsDto {
  id: string;
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  macAddress: string | null;
  mtu: number | null;
  rxBytes: number;
  txBytes: number;
  rxErrors: number;
  txErrors: number;
  rxDrops: number;
  txDrops: number;
  /**
   * Nombre de coupures du lien depuis le démarrage. Un compteur qui grimpe
   * sur le lien montant explique des plaintes que rien d'autre n'explique.
   */
  linkDowns: number;
  lastLinkUpTime: string | null;
  lastLinkDownTime: string | null;
}

/** Un service d'administration — `/ip/service`. */
export interface IpServiceDto {
  id: string;
  name: string;
  port: number | null;
  protocol: string | null;
  /**
   * Adresses autorisées à joindre ce service. Vide signifie **toutes**, ce
   * qui n'est pas la même chose qu'aucune — et c'est la confusion qui a
   * coupé l'accès à ce projet une fois.
   */
  availableFrom: string[];
  disabled: boolean;
  certificate: string | null;
  maxSessions: number | null;
}

/** L'état du service DDNS de MikroTik — `/ip/cloud`. */
export interface IpCloudDto {
  /** `auto`, `yes`, `no`… le routeur ne rend pas un booléen. */
  ddnsEnabled: string;
  /** Nul tant qu'aucun nom n'a été attribué — c'est le cas quand DDNS est coupé. */
  dnsName: string | null;
  publicAddress: string | null;
  updateTime: boolean;
  backToHomeVpn: string | null;
}

/** Une entrée ARP — `/ip/arp`. La correspondance adresse ↔ matériel. */
export interface ArpEntryDto {
  id: string;
  address: string;
  macAddress: string | null;
  interfaceName: string;
  /** Vrai quand l'entrée vient du trafic, faux quand elle a été posée à la main. */
  dynamic: boolean;
  /** Vrai quand l'adresse matérielle est connue. */
  complete: boolean;
  /** Issue d'un bail DHCP. */
  fromDhcp: boolean;
  status: string | null;
  disabled: boolean;
}

/** Un serveur DHCP — `/ip/dhcp-server`. */
export interface DhcpServerDto {
  id: string;
  name: string;
  interfaceName: string;
  addressPool: string | null;
  leaseTime: string | null;
  useRadius: boolean;
  disabled: boolean;
  invalid: boolean;
}

/**
 * Une règle de pare-feu — `/ip/firewall/filter` ou `/ip/firewall/nat`.
 *
 * L'ordre est la logique : une règle de pare-feu ne vaut que par sa place dans
 * la chaîne, la première qui correspond décide. D'où `position`, que RouterOS
 * ne renvoie pas — elle est déduite de l'ordre de lecture.
 */
export interface FirewallRuleDto {
  id: string;
  /** Position dans la liste, à partir de 0. C'est l'ordre d'évaluation. */
  position: number;
  chain: string;
  action: string;
  protocol: string | null;
  srcAddress: string | null;
  dstAddress: string | null;
  srcPort: string | null;
  dstPort: string | null;
  inInterface: string | null;
  outInterface: string | null;
  jumpTarget: string | null;
  toPorts: string | null;
  rejectWith: string | null;
  /**
   * Non vide quand la règle est posée par le HotSpot lui-même
   * (`from-client`, `!auth`…). Ces règles se refont toutes seules : les
   * toucher à la main ne sert à rien, elles reviennent.
   */
  hotspot: string | null;
  dynamic: boolean;
  disabled: boolean;
  invalid: boolean;
  log: boolean;
  logPrefix: string | null;
  bytes: number;
  packets: number;
  comment: string | null;
}

/** Les réglages du résolveur — `/ip/dns`. Un seul jeu par routeur. */
export interface DnsSettingsDto {
  /** Serveurs saisis à la main. */
  servers: string[];
  /** Serveurs reçus du fournisseur par DHCP ou PPPoE. */
  dynamicServers: string[];
  /**
   * Le routeur accepte-t-il de résoudre pour les autres ?
   *
   * Contrairement à ce qu'on lit souvent, le HotSpot n'en dépend pas : sur le
   * hAP du parc ce réglage est à `false` et le portail sert 646 comptes sans
   * broncher, parce que le HotSpot intercepte le DNS lui-même. À montrer,
   * donc, mais sans en tirer de conclusion hâtive.
   */
  allowRemoteRequests: boolean;
  /** Taille et occupation du cache, en Kio (RouterOS rend `2048`, pas `2048KiB`). */
  cacheSize: number | null;
  cacheUsed: number | null;
  maxConcurrentQueries: number | null;
  /** DNS sur HTTPS, vide quand il n'est pas utilisé. */
  useDohServer: string | null;
  verifyDohCert: boolean;
}

/** Une entrée DNS statique — `/ip/dns/static`. */
export interface DnsStaticEntryDto {
  id: string;
  name: string | null;
  address: string | null;
  type: string | null;
  ttlSeconds: number;
  dynamic: boolean;
  disabled: boolean;
  comment: string | null;
}

/** Une route — `/ip/route`. */
export interface RouteDto {
  id: string;
  dstAddress: string;
  gateway: string | null;
  /** La passerelle réellement retenue, interface comprise. */
  immediateGw: string | null;
  distance: number | null;
  routingTable: string | null;
  scope: number | null;
  targetScope: number | null;
  /** Fausse pour une route qui existe mais ne sert pas. */
  active: boolean;
  dynamic: boolean;
  /** Posée à la main. */
  isStatic: boolean;
  /** Déduite d'une adresse du routeur. */
  connect: boolean;
  /** Reçue du fournisseur par bail DHCP. */
  dhcp: boolean;
  comment: string | null;
}

/**
 * Une radio du routeur.
 *
 * Distinguer `disabled` de `running` est tout l'intérêt : une radio peut être
 * activée sans émettre. Relevé sur ce parc — les deux radios du hAP sont
 * activées, `running` à faux, et le Wi-Fi vient en réalité de bornes
 * externes branchées sur `ether2` à `ether5`. La console laissait croire que
 * le routeur diffusait lui-même.
 */
export interface WirelessInterfaceDto {
  id: string;
  name: string;
  ssid: string;
  /** « 2ghz-b/g/n », « 5ghz-a/n/ac » : la bande telle que RouterOS la nomme. */
  band: string;
  channelWidth: string;
  /** « auto » ou une fréquence en MHz. */
  frequency: string;
  mode: string;
  /** Vrai quand la radio émet réellement, par opposition à simplement activée. */
  running: boolean;
  disabled: boolean;
  hideSsid: boolean;
  macAddress: string;
  securityProfile: string;
  country: string;
  /** Puissance d'émission en dBm quand elle est fixée ; `null` si automatique. */
  txPowerDbm: number | null;
}

/** Un client associé à une radio, avec la qualité de sa liaison. */
export interface WirelessClientDto {
  id: string;
  interfaceName: string;
  macAddress: string;
  /** dBm : au-delà de -70 la liaison se dégrade, au-delà de -80 elle ne tient plus. */
  signalStrengthDbm: number | null;
  txRate: string | null;
  rxRate: string | null;
  uptimeSeconds: number | null;
}

/**
 * Le client RADIUS du routeur.
 *
 * C'est la pièce qui relie le HotSpot à User Manager : sans entrée active
 * pour le service `hotspot`, aucun ticket n'est vérifié, quoi que porte la
 * base des comptes. Sur ce parc elle pointe sur `127.0.0.1` — User Manager
 * tourne sur le routeur lui-même.
 */
export interface RadiusClientDto {
  id: string;
  /** Les services que cette entrée sert : `hotspot`, `ppp`, `login`… */
  services: string[];
  address: string;
  authenticationPort: number | null;
  accountingPort: number | null;
  disabled: boolean;
  timeout: string | null;
}

/** L'interface WireGuard du routeur, côté routeur. */
export interface WireguardInterfaceDto {
  id: string;
  name: string;
  listenPort: number | null;
  publicKey: string;
  running: boolean;
  disabled: boolean;
  comment: string | null;
}

/**
 * Un pair WireGuard, avec ce qui permet de savoir si le tunnel vit.
 *
 * `lastHandshakeSeconds` est le seul indicateur fiable : WireGuard n'a pas
 * d'état « connecté », une interface « running » ne dit rien du lien. Une
 * poignée de main de plus de trois minutes veut dire que le pair ne répond
 * plus, `persistent-keepalive` étant à 25 secondes.
 *
 * Le couple `tx` / `rx` dit **de quel côté** ça coince : du trafic émis sans
 * rien reçu est la signature exacte d'un pair qui parle dans le vide — une
 * adresse d'extrémité injoignable, un port fermé, un serveur éteint.
 */
export interface WireguardPeerDto {
  id: string;
  name: string | null;
  interfaceName: string;
  publicKey: string;
  /** L'adresse que ce pair appelle, telle qu'elle est configurée. */
  endpointAddress: string | null;
  endpointPort: number | null;
  allowedAddress: string;
  lastHandshakeSeconds: number | null;
  txBytes: number;
  rxBytes: number;
  disabled: boolean;
}

/**
 * Une adresse IP posée sur une interface.
 *
 * `dynamique` est le champ qui compte : une adresse obtenue par DHCP **peut
 * changer**, et l'exploitant qui la recopie quelque part — dans un pair
 * WireGuard, dans une règle de pare-feu — verra son réglage cesser de marcher
 * sans qu'aucune erreur ne l'explique. C'est exactement ce qui est arrivé sur
 * ce projet, et une heure de dépannage.
 */
export interface IpAddressDto {
  id: string;
  address: string;
  network: string;
  interfaceName: string;
  dynamique: boolean;
  disabled: boolean;
  /** Vrai quand l'adresse ne s'applique pas : interface absente ou éteinte. */
  invalide: boolean;
  comment: string | null;
}

/** Un pont, et ce qu'il fait des trames. */
export interface BridgeDto {
  id: string;
  name: string;
  protocolMode: string;
  vlanFiltering: boolean;
  running: boolean;
  disabled: boolean;
}

/**
 * Un port du pont.
 *
 * `inactif` distingue un port **branché mais sans lien** d'un port qui
 * travaille. Sur ce parc, les deux radios du routeur sont dans le pont et
 * inactives : le Wi-Fi vient de bornes sur les ports Ethernet.
 */
export interface BridgePortDto {
  id: string;
  interfaceName: string;
  bridgeName: string;
  inactif: boolean;
  disabled: boolean;
}

/** Le client DHCP d'une interface montante. */
export interface DhcpClientDto {
  id: string;
  interfaceName: string;
  /** `bound` quand un bail est en cours. */
  status: string;
  address: string | null;
  gateway: string | null;
  disabled: boolean;
}

/**
 * Un script enregistré sur le routeur — `/system/script`.
 *
 * Objet le plus puissant du routeur et le plus discret : un script porte ses
 * propres autorisations dans `policy`, indépendamment de qui le déclenche.
 * Sondé sur le hAP : `gen-4heure` cumule `write`, `password`, `sensitive` et
 * `reboot`, ce qui revient à un droit d'administration complet, exécutable par
 * l'ordonnanceur ou par quiconque atteint le terminal.
 */
export interface RouterScriptDto {
  id: string;
  name: string;
  /** Le compte qui a créé le script, pas celui qui l'exécute. */
  owner: string;
  /** `read`, `write`, `password`, `sensitive`, `reboot`… */
  policy: string[];
  /** Nombre d'exécutions depuis le dernier démarrage. `0` = jamais lancé. */
  runCount: number;
  /** Le code, tel quel. Long : à replier dans l'interface. */
  source: string;
  /**
   * Vrai quand le script s'exécute avec les droits de **celui qui le lance**
   * plutôt qu'avec sa propre `policy`. Le cas le plus sûr des deux.
   */
  dontRequirePermissions: boolean;
  invalide: boolean;
}

/**
 * Une entrée de l'ordonnanceur — `/system/scheduler`.
 *
 * `onEvent` désigne soit un script nommé, soit du code en ligne. Les deux
 * comptent : une tâche qui appelle un script hérite de la `policy` de
 * l'entrée, pas de celle du script.
 */
export interface RouterScheduleDto {
  id: string;
  name: string;
  /** Ce qui est lancé : nom de script ou code. */
  onEvent: string;
  /** `null` pour une exécution unique. */
  intervalSeconds: number | null;
  /** Date de départ, ou `startup` pour « à chaque démarrage ». */
  startDate: string | null;
  startTime: string | null;
  nextRun: string | null;
  runCount: number;
  owner: string;
  policy: string[];
  disabled: boolean;
}

/**
 * Un port cuivre — `/interface/ethernet` plus son `monitor`.
 *
 * Les deux lectures sont fusionnées parce que les champs décisifs se
 * répartissent entre elles : la configuration porte les compteurs d'erreurs et
 * la liste annoncée, le `monitor` porte le débit et le duplex **réellement
 * négociés**. Aucune ne suffit seule à dire si un port va bien.
 */
export interface EthernetPortDto {
  id: string;
  name: string;
  /** `link-ok`, `no-link`… tel que le routeur le nomme. */
  status: string;
  running: boolean;
  disabled: boolean;
  /** `100Mbps`, `1Gbps`… `null` tant qu'aucun lien n'est établi. */
  rate: string | null;
  /** `null` sans lien. **`false` est une anomalie**, pas un réglage. */
  fullDuplex: boolean | null;
  autoNegotiation: boolean;
  /** Les modes que **ce** port propose à la négociation. */
  advertise: string[];
  /** Les modes que la machine d'en face propose. Vide sans lien. */
  partnerAdvertise: string[];
  /**
   * Collisions. Sur une liaison commutée en duplex intégral, ce compteur doit
   * rester à zéro : toute valeur non nulle signale un duplex à moitié.
   */
  collisions: number;
  /** Trames tronquées — câble abîmé, ou conséquence des collisions. */
  fragments: number;
  /** Séquences de contrôle fausses : presque toujours le câble. */
  fcsErrors: number;
  rxBytes: number;
  txBytes: number;
  comment: string | null;
}

/**
 * Un certificat du routeur — `/certificate`.
 *
 * Celui qui sert l'API REST décide si la console peut vérifier à qui elle
 * parle. Un certificat auto-signé sans nom alternatif oblige à désactiver
 * la vérification TLS, ce qui laisse la porte ouverte à l'interception.
 */
export interface CertificateDto {
  id: string;
  name: string;
  commonName: string;
  /** Les noms pour lesquels le certificat est **aussi** valable. */
  subjectAltNames: string[];
  /** Vrai pour un certificat qui se signe lui-même. */
  selfSigned: boolean;
  /** Vrai si la clé privée est sur le routeur : sans elle, il ne peut servir. */
  hasPrivateKey: boolean;
  fingerprint: string;
  keyType: string;
  keySizeBits: number | null;
  invalidBefore: string | null;
  invalidAfter: string | null;
  /** Secondes restantes, négatif si déjà expiré. `null` si illisible. */
  expiresInSeconds: number | null;
}

/**
 * L'heure du routeur, et ce qui la tient à jour.
 *
 * Pièce load-bearing de ce produit : les échéances de forfaits, les dates de
 * validité User Manager et les dates portées sur les planches de tickets sont
 * toutes calculées contre cette horloge. Le code la lit déjà partout
 * (`parseRouterTime` prend son `gmtOffset` du routeur, jamais du serveur) —
 * mais rien ne la montrait à l'exploitant.
 */
export interface HorlogeRouteurDto {
  /** `2026-09-21`, dans le fuseau du routeur. */
  date: string;
  /** `01:29:12`, dans le fuseau du routeur. */
  time: string;
  /** `Africa/Nairobi`, `Indian/Antananarivo`… */
  timeZone: string;
  /** `+03:00`. C'est lui qui sert aux conversions, pas le nom du fuseau. */
  gmtOffset: string;
  dstActive: boolean;
  ntpEnabled: boolean;
  /** `synchronized` quand le routeur a bien recalé son heure. */
  ntpStatus: string;
  ntpServers: string[];
  /** Le serveur qui a réellement répondu, souvent plus parlant que la liste. */
  ntpSyncedServer: string | null;
  /** Plus il est bas, plus la source est proche d'une horloge de référence. */
  ntpStratum: number | null;
  /** Écart rattrapé au dernier recalage, en millisecondes. */
  ntpOffsetMs: number | null;
  /** Durée de marche, pour situer le dernier redémarrage. */
  uptime: string;
}

/**
 * Un compte d'administration du routeur — `/user`.
 *
 * À ne pas confondre avec un compte HotSpot : celui-ci ouvre le routeur
 * lui-même. `address` vide veut dire « depuis n'importe où », ce qui est le
 * cas des trois comptes de ce parc.
 */
export interface RouterAccountDto {
  id: string;
  name: string;
  /** Le groupe porte les droits ; le compte n'en a aucun en propre. */
  group: string;
  /** Adresses autorisées. Vide = aucune restriction. */
  address: string | null;
  disabled: boolean;
  /** `null` si le compte ne s'est jamais connecté. */
  lastLoggedIn: string | null;
  comment: string | null;
}

/** Un groupe de droits — `/user/group`. */
export interface RouterAccountGroupDto {
  id: string;
  name: string;
  /** Les permissions accordées, celles niées (`!x`) étant écartées. */
  policy: string[];
  /**
   * Vrai quand le groupe permet de **se donner** n'importe quel droit.
   *
   * C'est `policy` : créer des comptes et changer les permissions. Qui l'a
   * peut tout obtenir, y compris ce qu'on lui a refusé. Le distinguer de
   * `write` est indispensable — sinon les comptes de service, qui doivent
   * écrire, se retrouvent signalés au même titre que l'administrateur, et
   * l'avertissement ne veut plus rien dire.
   */
  controleTotal: boolean;
  /** Vrai quand le groupe peut modifier la configuration du routeur. */
  ecriture: boolean;
  /** Vrai quand le groupe donne accès aux secrets : mots de passe, capture. */
  secrets: boolean;
}

/**
 * Les portes d'entrée du routeur autres que l'API — `/tool/mac-server`,
 * `/ip/proxy`, `/ip/upnp`, `/snmp`.
 *
 * Elles se lisent ensemble parce que la question est unique : par où peut-on
 * entrer ? Relevé sur ce parc, `mac-server` accepte **toutes** les interfaces,
 * y compris le pont des clients — WinBox par adresse MAC est donc joignable
 * depuis le Wi-Fi public, sans passer par une adresse IP.
 */
export interface RouterExpositionDto {
  /** Liste d'interfaces où WinBox par MAC répond. `all` = partout. */
  macServerInterfaces: string;
  macPingEnabled: boolean;
  proxyEnabled: boolean;
  upnpEnabled: boolean;
  snmpEnabled: boolean;
}
