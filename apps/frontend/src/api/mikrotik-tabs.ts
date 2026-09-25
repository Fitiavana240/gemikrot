import { api } from './client';
import type { Coupure } from './coupure';

/** Ajoute `?routerId=` quand un routeur est sélectionné. */
function q(routerId: string | undefined, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (routerId) params.set('routerId', routerId);
  for (const [clé, valeur] of Object.entries(extra ?? {})) {
    if (valeur) params.set(clé, valeur);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Un compte de la table HotSpot du routeur.
 *
 * Distinct d'un compte User Manager : le HotSpot tient la sienne, et c'est
 * elle que WinBox montre sous « Users ». Sur ce parc, les comptes historiques
 * vivent ici ; les tickets vendus depuis sont passés à User Manager, seul
 * capable de faire expirer une validité calendaire.
 */
export interface HotspotUser {
  id: string;
  username: string;
  profile: string;
  disabled: boolean;
  /** Sur ce parc, le commentaire porte le nom de la personne. */
  comment: string | null;
  server: string | null;
  bytesIn: number;
  bytesOut: number;
  /** Temps deja consomme, cumule sur toutes les sessions du compte. */
  uptimeSeconds: number;
  /** Plafond, absent du routeur tant qu'il n'est pas pose : `null`, pas zero. */
  limitUptimeSeconds: number | null;
  /**
   * Quotas du **compte**, indépendants du profil.
   *
   * Le profil borne une session ; ceux-ci bornent le ticket vendu. Les croire
   * hérités ferait passer un ticket spécial pour un ticket ordinaire.
   */
  limitBytesIn: number | null;
  limitBytesOut: number | null;
  limitBytesTotal: number | null;
}

/**
 * Création d'un compte HotSpot.
 *
 * Ce n'est pas un ticket User Manager. Ici le plafond porte sur le **temps
 * passé connecté** : il ne s'écoule pas pendant que le client est
 * déconnecté, là où la validité d'un forfait User Manager est calendaire.
 * C'est ce que portent les tickets « 2h » du parc.
 *
 * Les champs que WinBox propose et que personne n'utilise ici — adresse MAC,
 * adresse fixe, courriel, routes, secret OTP — ne sont volontairement pas
 * exposés : sur les 646 comptes du parc, aucun n'en porte.
 */
export interface CreateHotspotUser {
  username: string;
  password: string;
  profileName: string;
  server?: string;
  comment?: string;
  limitUptimeSeconds?: number | null;
  /**
   * Quotas du compte, posés ticket par ticket.
   *
   * Ils ne découlent pas du profil : celui-ci borne une session, ceux-ci
   * bornent l'accès vendu. `null` retire le plafond, absent n'y touche pas.
   */
  limitBytesIn?: number | null;
  limitBytesOut?: number | null;
  limitBytesTotal?: number | null;
}

/** Le nom identifie le compte : il n'est pas modifiable. */
export type UpdateHotspotUser = Partial<Omit<CreateHotspotUser, 'username'>>;

/** Ce qu'un profil HotSpot accepte de changer. `null` retire une durée. */
export interface UpdateHotspotProfile {
  rateLimitRxBitsPerSecond?: number;
  rateLimitTxBitsPerSecond?: number;
  sessionTimeoutSeconds?: number;
  sharedUsers?: number;
  idleTimeoutSeconds?: number | null;
  keepaliveTimeoutSeconds?: number | null;
  addMacCookie?: boolean;
  macCookieTimeoutSeconds?: number | null;
}

export interface HotspotProfile {
  id: string;
  name: string;
  rateLimitRxBitsPerSecond: number | null;
  rateLimitTxBitsPerSecond: number | null;
  sessionTimeoutSeconds: number | null;
  sharedUsers: number;
  idleTimeoutSeconds: number | null;
  /** Délai sans réponse avant fermeture — distinct de l'inactivité. */
  keepaliveTimeoutSeconds: number | null;
  /**
   * Le profil pose-t-il un cookie à la connexion ?
   *
   * Le réglage le plus lourd de conséquences du menu : tant qu'il est actif,
   * un client déjà venu revient sans repasser par RADIUS, donc sans que sa
   * validité soit vérifiée, et bloquer son compte ne le coupe pas tout de
   * suite. Neuf sessions sur dix de ce parc sont entrées ainsi.
   */
  addMacCookie: boolean;
  macCookieTimeoutSeconds: number | null;
}

/** Un appareil vu par le HotSpot, authentifié ou non. */
export interface HotspotHost {
  id: string;
  macAddress: string;
  address: string | null;
  toAddress: string | null;
  server: string | null;
  idleTime: string | null;
  authorized?: boolean;
  bypassed?: boolean;
}

export interface IpBinding {
  id: string;
  macAddress: string;
  address: string | null;
  toAddress: string | null;
  type: string;
  server: string | null;
  comment: string | null;
  disabled?: boolean;
}

export interface DhcpLease {
  id: string;
  macAddress: string;
  address: string;
  hostName: string | null;
  status: string;
  comment: string | null;
}

/** Une authentification vue par RADIUS. Une entrée par cookie n'y figure pas. */
export interface UmSession {
  id: string;
  username: string;
  nasIpAddress: string | null;
  callingStationId: string | null;
  startTime: string | null;
  endTime: string | null;
  uptimeSeconds: number | null;
  active: boolean;
}

/** L'attribution profil/compte : c'est ici que vit l'échéance réelle. */
export interface UmAssignment {
  id: string;
  username: string;
  profileName: string;
  endTime: string | null;
  state: string;
  /**
   * L'attribution désigne un compte qui n'existe plus.
   *
   * RouterOS résout la référence en nom tant que le compte vit, et rend
   * l'identifiant brut — `*10` — une fois qu'il a disparu. La console
   * affichait cet identifiant dans la colonne « Compte » comme si c'était un
   * nom.
   */
  usernameIntrouvable: boolean;
}

/** Octets -> « 24,4 Gio ». Les multiples de 1024, comme RouterOS les compte. */
export function formatOctets(octets: number): string {
  if (!octets) return '—';
  const unites = ['o', 'Kio', 'Mio', 'Gio', 'Tio'];
  let valeur = octets;
  let rang = 0;
  while (valeur >= 1024 && rang < unites.length - 1) {
    valeur /= 1024;
    rang += 1;
  }
  return `${valeur.toFixed(rang === 0 ? 0 : 1)} ${unites[rang]}`;
}

/** Un client RADIUS declare. Le secret partage ne sort jamais du serveur. */
export interface UmRouter {
  id: string;
  name: string;
  address: string;
  protocol: string;
  coaPort: number | null;
  disabled: boolean;
  /** Seule la presence du secret est exposee, jamais sa valeur. */
  hasSharedSecret: boolean;
}

export interface UmUserGroup {
  id: string;
  name: string;
  outerAuths: string[];
  innerAuths: string[];
  attributes: string | null;
  isDefault: boolean;
}

export interface UmAttribute {
  id: string;
  name: string;
  standardName: string | null;
  typeId: number | null;
  valueType: string | null;
  vendorId: string | null;
  packetTypes: string[];
  isDefault: boolean;
}

export interface HotspotServerProfile {
  id: string;
  name: string;
  /** Methodes acceptees. `cookie` est la porte par laquelle un acces coupe revit. */
  loginBy: string[];
  httpCookieLifetimeSeconds: number | null;
  useRadius: boolean;
  dnsName: string | null;
  hotspotAddress: string | null;
}

export interface HotspotServicePort {
  id: string;
  name: string;
  ports: string;
  disabled: boolean;
}

export const hotspotTabsApi = {
  users: (routerId?: string) => api.get<HotspotUser[]>(`/hotspot/users${q(routerId)}`),
  profiles: (routerId?: string) => api.get<HotspotProfile[]>(`/hotspot/profiles${q(routerId)}`),
  /**
   * Modifie un profil. Le nom n'est pas modifiable : sur RouterOS il **est**
   * l'identifiant, et le changer abandonnerait les comptes qui le portent.
   */
  updateProfile: (name: string, dto: UpdateHotspotProfile, routerId?: string) =>
    api.patch<HotspotProfile>(
      `/hotspot/profiles/${encodeURIComponent(name)}${q(routerId)}`,
      dto,
    ),
  hosts: (routerId?: string) => api.get<HotspotHost[]>(`/hotspot/hosts${q(routerId)}`),
  ipBindings: (routerId?: string) => api.get<IpBinding[]>(`/hotspot/ip-bindings${q(routerId)}`),
  /**
   * Faire passer un appareil sans ticket, et lui poser une limite.
   *
   * **Écrit sur le routeur.** Les deux sens du plafond vont ensemble : c'est
   * un seul champ chez RouterOS, qu'il remplace en entier.
   */
  creerContournement: (
    dto: {
      macAddress: string;
      type: 'regular' | 'bypassed' | 'blocked';
      address?: string;
      comment?: string;
      limiteMontanteBps?: number;
      limiteDescendanteBps?: number;
    },
    routerId?: string,
  ) =>
    api.post<{ binding: IpBinding; file: { name: string } | null }>(
      `/hotspot/ip-bindings${q(routerId)}`,
      dto,
    ),
  /**
   * Force le routeur a reconsiderer un appareil deja connu.
   *
   * RouterOS decide du sort d'un appareil a son arrivee et garde sa decision :
   * un contournement pose apres coup ne s'applique jamais tout seul.
   */
  appliquerContournement: (id: string, routerId?: string) =>
    api.post<{ deja: boolean; message: string }>(
      `/hotspot/ip-bindings/${encodeURIComponent(id)}/appliquer${q(routerId)}`,
      {},
    ),
  /**
   * Changer ce que le routeur fait de cet appareil.
   *
   * Trois etats, et ils ne s'opposent pas deux a deux : `bypassed` passe sans
   * ticket, `blocked` n'obtient rien meme avec un ticket valide, et `regular`
   * passe par le portail **comme tout le monde**. Debloquer n'est donc pas une
   * seule action -- rendre son acces gratuit a quelqu'un qu'on vient de
   * bloquer n'est pas la meme decision que le remettre a la file.
   */
  changerTypeContournement: (
    id: string,
    type: 'regular' | 'bypassed' | 'blocked',
    routerId?: string,
  ) =>
    api.patch<IpBinding>(`/hotspot/ip-bindings/${encodeURIComponent(id)}${q(routerId)}`, { type }),
  /** Retire le contournement **et** la file d'attente qui l'accompagnait. */
  supprimerContournement: (id: string, routerId?: string) =>
    api.delete<{ fileRetiree: string | null }>(
      `/hotspot/ip-bindings/${encodeURIComponent(id)}${q(routerId)}`,
    ),
  serverProfiles: (routerId?: string) =>
    api.get<HotspotServerProfile[]>(`/hotspot/server-profiles${q(routerId)}`),
  servicePorts: (routerId?: string) =>
    api.get<HotspotServicePort[]>(`/hotspot/service-ports${q(routerId)}`),
  dhcpLeases: (routerId?: string) => api.get<DhcpLease[]>(`/hotspot/dhcp-leases${q(routerId)}`),
  /** Bloque ou reactive un compte sans le supprimer : l'historique reste. */
  setUserDisabled: (username: string, disabled: boolean, routerId?: string) =>
    api.patch<HotspotUser & { coupure: Coupure | null }>(
      `/hotspot/users/${encodeURIComponent(username)}/disabled${q(routerId)}`,
      { disabled },
    ),
  deleteUser: (username: string, routerId?: string) =>
    api.delete<void>(`/hotspot/users/${encodeURIComponent(username)}${q(routerId)}`),
  createUser: (dto: CreateHotspotUser, routerId?: string) =>
    api.post<HotspotUser>(`/hotspot/users${q(routerId)}`, dto),
  updateUser: (username: string, dto: UpdateHotspotUser, routerId?: string) =>
    api.patch<HotspotUser>(`/hotspot/users/${encodeURIComponent(username)}${q(routerId)}`, dto),
};

/**
 * Ce que les clients ont consomme, decoupe **a l'heure du routeur**.
 *
 * Le calcul se fait sur le serveur, et pas ici : les sessions portent des
 * dates sans fuseau, a lire dans l'heure du routeur. Le navigateur ne connait
 * que celle du poste qui l'ouvre -- decouper la journee ici ferait tomber
 * trois heures de sessions dans la mauvaise journee, chaque nuit.
 */
export interface Tranche {
  octets: number;
  sessions: number;
}

export interface Consommation {
  /** L'offset du routeur, pour dire d'ou vient le decoupage. */
  fuseau: string;
  sessionsLues: number;
  /**
   * Celles qui portaient une date lisible. Les autres ne sont comptees nulle
   * part -- et la cle porte son accent, parce que c'est ainsi que le serveur
   * l'ecrit. Un nom approchant se lirait `undefined`, sans erreur.
   */
  sessionsDatées: number;
  jour: Tranche;
  semaine: Tranche;
  mois: Tranche;
  parCompte: { username: string; octets: number; sessions: number }[];
  /** Les tickets qui ont servi aujourd'hui. Une ligne par compte. */
  comptesDuJour: {
    username: string;
    octets: number;
    sessions: number;
    /** Le dernier point d'acces emprunte, quand le routeur le dit. */
    point: string | null;
    /** Le dernier appareil vu, tel que RADIUS l'a note. */
    appareil: string | null;
  }[];
  /** Par point d'acces, sur le mois : d'ou vient la consommation. */
  parPointDAccès: { point: string; octets: number; sessions: number; comptes: number }[];
}

export const umTabsApi = {
  consommation: (routerId?: string) =>
    api.get<Consommation>(`/user-manager/consommation${q(routerId)}`),
  routers: (routerId?: string) => api.get<UmRouter[]>(`/user-manager/routers${q(routerId)}`),
  userGroups: (routerId?: string) =>
    api.get<UmUserGroup[]>(`/user-manager/user-groups${q(routerId)}`),
  attributes: (routerId?: string) =>
    api.get<UmAttribute[]>(`/user-manager/attributes${q(routerId)}`),
  sessions: (routerId?: string, username?: string) =>
    api.get<UmSession[]>(`/user-manager/sessions${q(routerId, { username: username ?? '' })}`),
  assignments: (routerId?: string, username?: string) =>
    api.get<UmAssignment[]>(`/user-manager/assignments${q(routerId, { username: username ?? '' })}`),
  payments: (routerId?: string) => api.get<UmPayment[]>(`/user-manager/payments${q(routerId)}`),
  /**
   * Attribue un profil à un compte — le « User Profile > New » de WinBox.
   *
   * La route existait côté serveur et aucun écran ne l'appelait : attribuer
   * un profil supposait donc d'ouvrir WinBox.
   */
  profileLimitations: (routerId?: string) =>
    api.get<UmProfileLimitation[]>(`/user-manager/profile-limitations${q(routerId)}`),
  attribuer: (username: string, profileName: string, routerId?: string) =>
    api.post<UmAssignment>(
      `/user-manager/users/${encodeURIComponent(username)}/profiles${q(routerId)}`,
      { profileName },
    ),
  retirer: (username: string, profileName: string, routerId?: string) =>
    api.delete<void>(
      `/user-manager/users/${encodeURIComponent(username)}/profiles/${encodeURIComponent(profileName)}${q(routerId)}`,
    ),
};

/**
 * Un paiement noté par le routeur — `/user-manager/payment`.
 *
 * **Noms de champs non vérifiés sur matériel** : la collection répond mais
 * elle est vide sur le parc, qui encaisse par Mobile Money hors du routeur.
 * Ces champs viennent des colonnes de WinBox, pas d'un relevé.
 */
export interface UmPayment {
  id: string;
  username: string;
  profileName: string | null;
  price: string | null;
  currency: string | null;
  transactionStart: string | null;
  transactionEnd: string | null;
  transactionStatus: string | null;
}

/** bits/s → « 6 Mb/s », ou un tiret quand il n'y a pas de limite. */
export function formatDebit(bits: number | null): string {
  if (bits == null || bits === 0) return '—';
  if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(bits % 1_000_000 === 0 ? 0 : 1)} Mb/s`;
  if (bits >= 1_000) return `${Math.round(bits / 1_000)} kb/s`;
  return `${bits} b/s`;
}

/** Secondes → « 2 h 30 », ou un tiret. */
export function formatDuree(secondes: number | null): string {
  if (secondes == null || secondes === 0) return '—';
  const j = Math.floor(secondes / 86400);
  const h = Math.floor((secondes % 86400) / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  if (j > 0) return `${j} j ${h} h`;
  if (h > 0) return `${h} h ${m.toString().padStart(2, '0')}`;
  return `${m} min`;
}

/**
 * Quelle limitation s'applique à quel forfait, et sous quelles conditions.
 *
 * Les trois derniers champs faisaient défaut : une limitation peut n'être
 * active qu'à certaines heures ou certains jours.
 */
export interface UmProfileLimitation {
  id: string;
  profileName: string;
  limitationName: string;
  /** Secondes depuis minuit. `0` est une heure valide, pas une absence. */
  fromTimeSeconds: number | null;
  tillTimeSeconds: number | null;
  weekdays: string[];
}
