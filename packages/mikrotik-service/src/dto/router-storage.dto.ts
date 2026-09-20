/**
 * Stockage du routeur, et ce qui en dépend.
 *
 * Ce fichier existe pour une raison précise du parc : sur un hAP ac², la
 * mémoire interne fait 16 Mio et se remplit. User Manager ne tient plus
 * dessus, sa base vit donc sur une clé USB. Cela marche très bien — et cela
 * crée une dépendance matérielle que personne ne voit : **clé retirée, base
 * perdue, tous les tickets avec**.
 *
 * La console doit donc savoir répondre à « où vivent mes données, et
 * combien de place reste-t-il », avant qu'on l'apprenne autrement.
 */

/** Un fichier ou un dossier — `/file`. */
export interface RouterFileDto {
  id: string;
  /** Chemin complet, racine comprise : `flash/hotspot/login.html`. */
  name: string;
  /** Racine du chemin : `flash`, `usb1-part1`, `um5files`… */
  root: string;
  /** `directory`, `disk`, `backup`, `.html file`… tel que RouterOS l'écrit. */
  type: string;
  /** Absente pour un dossier. */
  sizeBytes: number | null;
  /**
   * Heure locale du routeur, sans fuseau — telle qu'il l'écrit. Elle n'est
   * pas convertie : un routeur dont l'horloge dérive mentirait deux fois.
   */
  lastModified: string | null;
}

/** Un disque — `/disk`. Le matériel ET ses partitions y figurent. */
export interface RouterDiskDto {
  id: string;
  /** `usb1` pour le matériel, `usb1-part1` pour sa partition. */
  slot: string;
  /** `hardware` pour la clé elle-même, `partition` pour ce qui est utilisable. */
  type: string;
  /** Système de fichiers : `ext4`, `vfat`… `-` quand la clé n'est pas formatée. */
  fs: string | null;
  model: string | null;
  serial: string | null;
  sizeBytes: number | null;
  freeBytes: number | null;
  /**
   * Seule une partition **montée** est utilisable. Une clé branchée mais non
   * montée est aussi absente qu'une clé retirée.
   */
  mounted: boolean;
  mountPoint: string | null;
  /** Vrai pour une partition, faux pour le matériel qui la porte. */
  isPartition: boolean;
  interfaceName: string | null;
  disabled: boolean;
}

/** Un paquet RouterOS — `/system/package`. */
export interface RouterPackageDto {
  id: string;
  name: string;
  version: string | null;
  sizeBytes: number | null;
  /**
   * Un paquet désactivé reste sur le disque mais ne tourne pas — et son
   * menu disparaît de WinBox. C'est la première chose à vérifier quand un
   * onglet « manque ».
   */
  disabled: boolean;
  buildTime: string | null;
  /**
   * Ce qui est prévu au prochain démarrage : `enable`, `disable`, ou vide.
   *
   * C'est le **seul** observable qui prouve qu'une activation a été prise en
   * compte : `disabled` ne bouge qu'après le redémarrage, si bien que sans ce
   * champ une activation réussie ressemble à une activation ignorée.
   */
  scheduled: string | null;
}

/** Ce que le routeur dit de lui-même — `/system/resource`. */
export interface RouterStorageDto {
  boardName: string | null;
  version: string | null;
  architecture: string | null;
  /** Mémoire interne, celle qui manque. */
  internalTotalBytes: number;
  internalFreeBytes: number;
  memoryTotalBytes: number;
  memoryFreeBytes: number;
  disks: RouterDiskDto[];
  packages: RouterPackageDto[];
  /** Occupation par racine, calculée en additionnant `/file`. */
  parRacine: { root: string; bytes: number; fileCount: number }[];
}

/** Gravité d'un constat, du plus urgent au plus bénin. */
export type NiveauConstat = 'bloquant' | 'avertissement' | 'ok';

/** Un point de diagnostic, avec le geste qui le corrige quand il en existe un. */
export interface ConstatDto {
  /** Identifiant stable, pour que l'interface puisse s'y accrocher. */
  code: string;
  niveau: NiveauConstat;
  titre: string;
  detail: string;
  /**
   * La commande exacte à coller dans le terminal, ou `null` quand le geste
   * n'est pas une commande (brancher une clé, téléverser un paquet).
   */
  commande: string | null;
  /**
   * Le nom de la réparation que la console sait appliquer elle-même, ou
   * `null` quand le geste lui échappe.
   *
   * Sont volontairement sans réparation : tout ce qui est physique (brancher
   * une clé, téléverser un paquet) et tout ce qui déplace des données déjà
   * vendues. Un bouton qui déplace une base de tickets n'a pas sa place à
   * côté d'un bouton qui rallume un service.
   */
  reparation: string | null;
}

/**
 * L'état de préparation de User Manager, de bout en bout.
 *
 * Répond à la question que pose tout nouveau routeur : « pourquoi l'onglet
 * User Manager n'apparaît-il pas ? » — réponse : parce que le paquet est un
 * supplément, il n'est pas dans l'image de base.
 */
export interface UserManagerReadinessDto {
  /** Le paquet est-il présent ? Absent = pas d'onglet, pas de service. */
  packageInstalled: boolean;
  packageEnabled: boolean;
  packageVersion: string | null;
  packageSizeBytes: number | null;
  /**
   * Ce qui attend le prochain démarrage (`enable`, `disable`, ou `null`).
   *
   * Sans ce champ, une activation réussie serait indiscernable d'une
   * activation ignorée : `packageEnabled` ne bascule qu'après le redémarrage.
   */
  packageScheduled: string | null;
  /** Le service RADIUS de User Manager est-il allumé ? */
  serviceEnabled: boolean;
  /** Sans profils, User Manager n'est qu'un RADIUS : pas de forfaits. */
  useProfiles: boolean;
  /** `null` quand le paquet n'est pas là pour répondre. */
  database: {
    /** `/usb1-part1/user-manager` sur un routeur dont la base est sur clé. */
    path: string;
    sizeBytes: number;
    /** Place restante **là où la base vit**, pas sur le flash interne. */
    freeBytes: number;
    /** Déduit du chemin : la base repose-t-elle sur un support amovible ? */
    surSupportAmovible: boolean;
  } | null;
  /** Le fond du problème, en un chiffre. */
  internalFreeBytes: number;
  internalTotalBytes: number;
  disks: RouterDiskDto[];
  /** Trié : les bloquants d'abord. */
  constats: ConstatDto[];
}
