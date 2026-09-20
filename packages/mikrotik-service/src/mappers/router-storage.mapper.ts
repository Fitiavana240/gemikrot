import {
  ConstatDto,
  RouterDiskDto,
  RouterFileDto,
  RouterPackageDto,
  RouterStorageDto,
  UserManagerReadinessDto,
} from '../dto/router-storage.dto';

function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

function orNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
  return text === '' || text === '-' ? null : text;
}

function nombreOuNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `flash/hotspot/login.html` → `flash`. `/usb1-part1/user-manager` → `usb1-part1`. */
export function racineDuChemin(chemin: string): string {
  return chemin.replace(/^\/+/, '').split('/')[0] ?? '';
}

export function mapRouterFile(raw: any): RouterFileDto {
  const name = String(raw?.name ?? '');
  return {
    id: raw?.['.id'] ?? '',
    name,
    root: racineDuChemin(name),
    type: raw?.type ?? '',
    sizeBytes: nombreOuNull(raw?.size),
    lastModified: orNull(raw?.['last-modified']),
  };
}

export function mapRouterDisk(raw: any): RouterDiskDto {
  return {
    id: raw?.['.id'] ?? '',
    slot: raw?.slot ?? '',
    type: raw?.type ?? '',
    // `-` quand la clé n'est pas formatée : `orNull` le rend `null`, ce qui
    // est la vérité — pas de système de fichiers, donc rien d'utilisable.
    fs: orNull(raw?.fs),
    model: orNull(raw?.model),
    serial: orNull(raw?.serial),
    sizeBytes: nombreOuNull(raw?.size),
    // `/disk` ne rend PAS l'espace libre sur RouterOS 7.24 : le champ est
    // absent, même pour une partition montée. Le seul chiffre fiable pour le
    // volume de User Manager vient de `/user-manager/database`.
    freeBytes: nombreOuNull(raw?.free),
    mounted: flag(raw?.mounted),
    mountPoint: orNull(raw?.['mount-point']),
    isPartition: flag(raw?.partition),
    interfaceName: orNull(raw?.interface),
    disabled: flag(raw?.disabled),
  };
}

export function mapRouterPackage(raw: any): RouterPackageDto {
  return {
    id: raw?.['.id'] ?? '',
    name: raw?.name ?? '',
    version: orNull(raw?.version),
    sizeBytes: nombreOuNull(raw?.size),
    disabled: flag(raw?.disabled),
    buildTime: orNull(raw?.['build-time']),
  };
}

export function mapRouterStorage(
  resource: any,
  disksRaw: any[],
  packagesRaw: any[],
  filesRaw: any[],
): RouterStorageDto {
  const fichiers = filesRaw.map(mapRouterFile);

  const cumul = new Map<string, { bytes: number; fileCount: number }>();
  for (const fichier of fichiers) {
    const entree = cumul.get(fichier.root) ?? { bytes: 0, fileCount: 0 };
    entree.bytes += fichier.sizeBytes ?? 0;
    // Les dossiers et les disques ne sont pas des fichiers : les compter
    // gonflerait le nombre sans rien représenter.
    if (fichier.type !== 'directory' && fichier.type !== 'disk') entree.fileCount += 1;
    cumul.set(fichier.root, entree);
  }

  return {
    boardName: orNull(resource?.['board-name']),
    version: orNull(resource?.version),
    architecture: orNull(resource?.['architecture-name']),
    internalTotalBytes: Number(resource?.['total-hdd-space']) || 0,
    internalFreeBytes: Number(resource?.['free-hdd-space']) || 0,
    memoryTotalBytes: Number(resource?.['total-memory']) || 0,
    memoryFreeBytes: Number(resource?.['free-memory']) || 0,
    disks: disksRaw.map(mapRouterDisk),
    packages: packagesRaw.map(mapRouterPackage),
    parRacine: [...cumul.entries()]
      .map(([root, v]) => ({ root, ...v }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}

/** En deçà, la base n'a plus de marge pour grandir. */
const MARGE_BASE_MINIMALE = 20 * 1024 * 1024;
/** En deçà, plus de place pour une sauvegarde ni pour une mise à jour. */
const MARGE_FLASH_MINIMALE = 1024 * 1024;

const NOM_PAQUET = 'user-manager';

function estAmovible(disque: RouterDiskDto | undefined): boolean {
  if (!disque) return false;
  return (
    disque.slot.toLowerCase().startsWith('usb') ||
    (disque.interfaceName ?? '').toUpperCase().includes('USB')
  );
}

function mio(octets: number): string {
  return `${(octets / (1024 * 1024)).toFixed(octets < 10 * 1024 * 1024 ? 1 : 0)} Mio`;
}

/**
 * Le diagnostic complet de User Manager : est-il là, tourne-t-il, et où
 * vivent ses données ?
 *
 * Fonction pure, et volontairement : c'est la seule partie de ce module qui
 * porte un jugement, elle doit pouvoir être éprouvée sans routeur.
 *
 * L'ordre d'écriture des constats n'est pas leur ordre d'affichage — ils sont
 * triés par gravité à la fin. Écrire une règle plus haut ne la rend pas plus
 * urgente.
 */
export function evaluerUserManager(entree: {
  packagesRaw: any[];
  /** `/user-manager` ; `null` si l'appel a échoué, ce qui arrive sans le paquet. */
  serviceRaw: any | null;
  /** `/user-manager/database` ; `null` de même. */
  databaseRaw: any | null;
  resource: any;
  disksRaw: any[];
}): UserManagerReadinessDto {
  const packages = entree.packagesRaw.map(mapRouterPackage);
  const disks = entree.disksRaw.map(mapRouterDisk);
  const paquet = packages.find((p) => p.name === NOM_PAQUET);

  const internalFreeBytes = Number(entree.resource?.['free-hdd-space']) || 0;
  const internalTotalBytes = Number(entree.resource?.['total-hdd-space']) || 0;

  const chemin = orNull(entree.databaseRaw?.['db-path']);
  const racine = chemin ? racineDuChemin(chemin) : null;
  const disqueBase = racine ? disks.find((d) => d.slot === racine) : undefined;
  const amovible = estAmovible(disqueBase);

  const database = chemin
    ? {
        path: chemin,
        sizeBytes: Number(entree.databaseRaw?.['db-size']) || 0,
        freeBytes: Number(entree.databaseRaw?.['free-disk-space']) || 0,
        surSupportAmovible: amovible,
      }
    : null;

  const serviceEnabled = flag(entree.serviceRaw?.enabled);
  const useProfiles = flag(entree.serviceRaw?.['use-profiles']);
  const constats: ConstatDto[] = [];

  // --- Le support, avant tout le reste ------------------------------------
  //
  // Si la base est sur un volume absent, rien d'autre n'a d'importance : les
  // tickets ne sont plus lisibles. C'est le seul scénario de cette liste qui
  // fait disparaître des données déjà vendues.
  if (racine && racine !== 'flash' && !disqueBase) {
    constats.push({
      code: 'volume-base-absent',
      niveau: 'bloquant',
      titre: 'Le support de la base a disparu',
      detail:
        `La base User Manager est déclarée sur « ${chemin} », mais le routeur ne ` +
        `voit aucun volume nommé « ${racine} ». Si c'est une clé USB, elle a été ` +
        `retirée ou n'est plus reconnue : les tickets déjà vendus sont illisibles ` +
        `tant qu'elle n'est pas rebranchée. Ne recréez rien avant de l'avoir cherchée.`,
      commande: '/disk/print',
    });
  } else if (disqueBase && !disqueBase.mounted) {
    constats.push({
      code: 'volume-base-non-monte',
      niveau: 'bloquant',
      titre: 'Le support est branché mais non monté',
      detail:
        `« ${racine} » est présent mais n'est pas monté : pour User Manager, ` +
        `c'est comme s'il était absent. Un volume non monté n'est pas lisible.` +
        (disqueBase.fs === null
          ? ` Ce volume n'a pas de système de fichiers reconnu — il n'a peut-être jamais été formaté.`
          : ''),
      commande: '/disk/print detail',
    });
  } else if (database?.surSupportAmovible) {
    constats.push({
      code: 'base-sur-support-amovible',
      niveau: 'ok',
      titre: 'La base vit sur un support amovible',
      detail:
        `La base est sur « ${racine} » (${disqueBase?.model ?? 'support externe'}). ` +
        `C'est le bon choix quand la mémoire interne est pleine, et c'est ce qui ` +
        `permet à User Manager de tenir le calendrier. Mais cela crée une ` +
        `dépendance matérielle : cette clé ne doit jamais être retirée routeur ` +
        `allumé, et elle mérite une sauvegarde régulière — c'est elle qui porte ` +
        `tous les tickets.`,
      commande: null,
    });
  }

  // --- Le paquet ----------------------------------------------------------
  if (!paquet) {
    constats.push({
      code: 'paquet-absent',
      niveau: 'bloquant',
      titre: "Le paquet User Manager n'est pas installé",
      detail:
        `C'est la raison pour laquelle le menu « User Manager » n'apparaît pas ` +
        `dans WinBox : il ne fait pas partie de l'image de base de RouterOS, ` +
        `c'est un supplément à installer. Il faut téléverser le .npk qui ` +
        `correspond exactement à la version (${orNull(entree.resource?.version) ?? '?'}) ` +
        `et à l'architecture (${orNull(entree.resource?.['architecture-name']) ?? '?'}) ` +
        `du routeur, puis redémarrer — l'installation se fait au démarrage.` +
        (internalFreeBytes < 512 * 1024
          ? ` Attention : il ne reste que ${mio(internalFreeBytes)} sur la mémoire ` +
            `interne. Faites de la place avant de téléverser, sinon l'envoi échouera.`
          : ''),
      commande: null,
    });
  } else if (paquet.disabled) {
    constats.push({
      code: 'paquet-desactive',
      niveau: 'bloquant',
      titre: 'Le paquet est installé mais désactivé',
      detail:
        `Le paquet est bien sur le routeur, mais désactivé : son menu ne ` +
        `s'affiche pas et le service ne tourne pas. Le réactiver demande un ` +
        `redémarrage — un changement de paquet ne prend effet qu'au démarrage.`,
      commande: `/system/package/enable ${NOM_PAQUET}`,
    });
  }

  // --- Le service ---------------------------------------------------------
  if (paquet && !paquet.disabled && entree.serviceRaw && !serviceEnabled) {
    constats.push({
      code: 'service-eteint',
      niveau: 'bloquant',
      titre: 'Le service User Manager est éteint',
      detail:
        `Le paquet est là, mais le serveur RADIUS ne tourne pas : aucun ticket ` +
        `ne peut être authentifié. Les comptes existants ne sont pas perdus, ` +
        `ils ne répondent simplement plus.`,
      commande: '/user-manager/set enabled=yes',
    });
  }

  if (paquet && entree.serviceRaw && serviceEnabled && !useProfiles) {
    constats.push({
      code: 'profils-desactives',
      niveau: 'avertissement',
      titre: 'Les profils sont désactivés',
      detail:
        `Sans profils, User Manager n'est qu'un serveur RADIUS : pas de forfaits, ` +
        `pas de durée de validité, pas de limite de débit par offre. C'est le ` +
        `réglage qui rend les tickets vendables.`,
      commande: '/user-manager/set use-profiles=yes',
    });
  }

  // --- La place -----------------------------------------------------------
  if (database && !amovible && disks.some((d) => estAmovible(d) && d.mounted)) {
    constats.push({
      code: 'base-sur-flash-interne',
      niveau: 'avertissement',
      titre: 'La base est sur la mémoire interne',
      detail:
        `Une clé USB montée est disponible, et la base est restée sur la mémoire ` +
        `interne — la plus petite, celle qui sert aussi aux sauvegardes et aux ` +
        `mises à jour. La déplacer libère de la place et met la base sur un ` +
        `support plus grand. Faites d'abord une sauvegarde : le déplacement ` +
        `touche des données déjà vendues.`,
      commande: null,
    });
  }

  if (database && database.freeBytes > 0 && database.freeBytes < MARGE_BASE_MINIMALE) {
    constats.push({
      code: 'base-presque-pleine',
      niveau: 'avertissement',
      titre: 'Le support de la base se remplit',
      detail:
        `Il reste ${mio(database.freeBytes)} là où vit la base (elle en occupe ` +
        `${mio(database.sizeBytes)}). Un support plein empêche User Manager ` +
        `d'écrire : les sessions ne sont plus comptées.`,
      commande: null,
    });
  }

  if (internalFreeBytes > 0 && internalFreeBytes < MARGE_FLASH_MINIMALE) {
    constats.push({
      code: 'flash-interne-saturee',
      niveau: 'avertissement',
      titre: 'La mémoire interne est saturée',
      detail:
        `Il reste ${mio(internalFreeBytes)} sur ${mio(internalTotalBytes)}. ` +
        `Ce n'est pas gênant au quotidien, mais c'est trop peu pour une ` +
        `sauvegarde de configuration ou une mise à jour de RouterOS — les deux ` +
        `échoueront sans explication claire le jour où vous en aurez besoin.`,
      commande: '/file/print where size>100000',
    });
  }

  const rang: Record<ConstatDto['niveau'], number> = { bloquant: 0, avertissement: 1, ok: 2 };

  return {
    packageInstalled: paquet != null,
    packageEnabled: paquet != null && !paquet.disabled,
    packageVersion: paquet?.version ?? null,
    packageSizeBytes: paquet?.sizeBytes ?? null,
    serviceEnabled,
    useProfiles,
    database,
    internalFreeBytes,
    internalTotalBytes,
    disks,
    constats: constats.sort((a, b) => rang[a.niveau] - rang[b.niveau]),
  };
}
