import { api, telecharger } from './client';
import type { Coupure } from './coupure';
import { routerQuery } from '../routers/RouterContext';

export interface HotspotServerProfile {
  id: string;
  name: string;
  dnsName: string | null;
  hotspotAddress: string | null;
  htmlDirectory: string | null;
  /** Moyens d'authentification acceptés : `cookie` contourne RADIUS. */
  loginBy: string[];
  httpCookieLifetimeSeconds: number | null;
  useRadius: boolean;
  radiusAccounting: boolean;
}

export interface HotspotServer {
  id: string;
  name: string;
  interfaceName: string | null;
  addressPool: string | null;
  profileName: string | null;
  idleTimeoutSeconds: number | null;
  addressesPerMac: number | null;
  disabled: boolean;
  profile: HotspotServerProfile | null;
}

export interface HotspotOverview {
  servers: HotspotServer[];
  profiles: HotspotServerProfile[];
  cookieCount: number;
  activeSessionCount: number;
  /** Sessions entrées sans passer par RADIUS — non coupées par une suspension. */
  sessionsWithoutRadius: number;
}

export interface WalledGardenEntry {
  id: string;
  action: 'allow' | 'deny';
  dstHost: string | null;
  dstPort: string | null;
  comment: string | null;
  disabled: boolean;
  hits: number;
}

export interface WalledGardenIpEntry {
  id: string;
  action: 'accept' | 'drop' | 'reject';
  dstAddress: string | null;
  dstPort: string | null;
  protocol: string | null;
  comment: string | null;
  disabled: boolean;
}

/**
 * Le stock de tickets posé sur le routeur.
 *
 * À ne **jamais additionner** avec le compte des tickets de la base : un
 * ticket imprimé et perdu compte ici et pas là, un ticket créé dans
 * l'application pour un autre routeur compte là et pas ici.
 */
export interface StockRouteur {
  total: number;
  /** Comptes actifs jamais connectés : des tickets qui n'ont pas servi. */
  jamaisUtilises: number;
  parProfil: { profil: string; nombre: number }[];
}

export interface HotspotCookie {
  id: string;
  username: string;
  macAddress: string;
  expiresInSeconds: number;
  /**
   * Ce que devient le compte derrière ce cookie.
   *
   * `bloque` et `absent` sont des reliquats : quelqu'un a bloqué ou supprimé
   * le compte et le cookie est resté. Dans une liste d'une cinquantaine de
   * lignes, ils étaient introuvables à l'œil.
   */
  etatDuCompte: 'actif' | 'bloque' | 'absent';
}

export interface SessionView {
  id: string;
  username: string;
  startedAt: string | null;
  endedAt: string | null;
  uptimeSeconds: number;
  bytesIn: number;
  bytesOut: number;
  callingStationId: string | null;
  terminateCause: string | null;
  active: boolean;
}

/** Ce que l'exploitant règle de sa page de connexion captive. */
export interface ReglagesPageConnexion {
  titre: string;
  sousTitre: string;
  labelCode: string;
  libelleConnexion: string;
  /** Le texte du bouton d'achat. Son existence, elle, ne se règle pas. */
  libelleAchat: string;
  aideAchat: string;
  piedDePage: string;
  couleur: string;
  logoUrl: string | null;
  portailUrl: string;
  /** Où se trouve le local, tel qu'on l'explique à quelqu'un du quartier. */
  adresse: string;
  telephones: string;
  /** En toutes lettres, jamais un lien : un client captif n'a pas Internet. */
  reseauSocial: string;
  /** Le tableau des tarifs, calculé depuis les offres actives à ticket. */
  afficherTarifs: boolean;
  titreTarifs: string;
  /** Les offres retirées de l'affiche — pas de la vente. */
  tarifsMasques: string[];
}

/** Une offre, telle que l'écran propose de la montrer ou non. */
export interface LigneTarif {
  id: string;
  nom: string;
  prix: string;
  duree: string;
  appareils: number | null;
  visible: boolean;
}

/** Une adresse que le client captif pourrait atteindre, déduite. */
export interface AdresseCandidate {
  url: string;
  source: 'reseau-local' | 'domaine';
  autorisee: boolean;
}

/** Un dossier que sert au moins un serveur HotSpot actif de ce routeur. */
export interface CiblePublication {
  chemin: string;
  serveurs: string[];
  motDePasseEnClairAccepte: boolean;
  publie: { octets: number; publieLe: string } | null;
  surLeRouteur: { octets: number | null; modifieLe: string | null } | null;
}

export interface EtatPageConnexion {
  reglages: ReglagesPageConnexion;
  parDefaut: boolean;
  tarifs: LigneTarif[];
  adresses: AdresseCandidate[];
  cibles: CiblePublication[];
  /** Ce qui empêche de publier. Vide, la publication est possible. */
  empechements: string[];
  avertissements: string[];
}

export const hotspotApi = {
  /**
   * PUB-7 : la page du portail, remplie mais pas envoyée.
   *
   * Les réglages en cours de saisie sont passés tels quels : l'aperçu suit ce
   * qu'on tape, sans que rien ne soit enregistré.
   */
  apercuPageConnexion: (reglages: Partial<ReglagesPageConnexion>) =>
    api.post<{ contenu: string; octets: number }>('/hotspot/page-connexion/apercu', reglages),
  /**
   * Les réglages enregistrés, et où la page doit aller sur ce routeur.
   *
   * `portailUrl` permet de faire suivre l'adresse en cours de saisie : sans
   * elle, le refus ne se révélerait qu'après enregistrement.
   */
  etatPageConnexion: (routerId?: string, portailUrl?: string) => {
    const q = new URLSearchParams();
    if (routerId) q.set('routerId', routerId);
    if (portailUrl) q.set('portailUrl', portailUrl);
    // Le port par lequel la console est consultée : le serveur ne le connaît
    // pas — en développement le navigateur parle à Vite sur 5173, qui relaie
    // vers l'API sur 3000. C'est lui qui rend les adresses proposées
    // utilisables telles quelles plutôt qu'à compléter de tête.
    if (window.location.port) q.set('portConsole', window.location.port);
    return api.get<EtatPageConnexion>(`/hotspot/page-connexion/etat?${q}`);
  },
  /** Enregistre les réglages. Rien n'est envoyé au routeur. */
  enregistrerPageConnexion: (reglages: Partial<ReglagesPageConnexion>) =>
    api.patch<{ reglages: ReglagesPageConnexion; parDefaut: boolean }>(
      '/hotspot/page-connexion',
      reglages,
    ),
  /**
   * Télécharge le fichier, à poser soi-même dans le routeur.
   *
   * Le second chemin, et le seul qui marche quand la console n'atteint pas le
   * routeur — ce qui sera le cas de la plupart des exploitants tant qu'il n'y
   * a ni tunnel ni adresse publique.
   */
  telechargerPageConnexion: (reglages: Partial<ReglagesPageConnexion>) =>
    telecharger('/hotspot/page-connexion/fichier', 'login.html', reglages),
  /** Écrit la page sur chaque dossier réellement servi par le routeur. */
  publierPageConnexion: (routerId?: string) =>
    api.post<{ ecrits: { chemin: string; octets: number }[] }>(
      `/hotspot/page-connexion${routerId ? `?routerId=${routerId}` : ''}`,
      {},
    ),
  overview: (routerId?: string) =>
    api.get<HotspotOverview>(`/hotspot/overview${routerQuery(routerId)}`),
  walledGarden: (routerId?: string) =>
    api.get<{ hosts: WalledGardenEntry[]; ips: WalledGardenIpEntry[] }>(
      `/hotspot/walled-garden${routerQuery(routerId)}`,
    ),
  addHost: (input: { dstHost: string; comment?: string }, routerId?: string) =>
    api.post<WalledGardenEntry>(`/hotspot/walled-garden${routerQuery(routerId)}`, input),
  removeHost: (id: string, routerId?: string) =>
    api.delete<void>(`/hotspot/walled-garden/${encodeURIComponent(id)}${routerQuery(routerId)}`),
  addIp: (
    input: { dstAddress: string; dstPort?: string; comment?: string },
    routerId?: string,
  ) =>
    api.post<WalledGardenIpEntry>(`/hotspot/walled-garden/ip${routerQuery(routerId)}`, input),
  removeIp: (id: string, routerId?: string) =>
    api.delete<void>(`/hotspot/walled-garden/ip/${encodeURIComponent(id)}${routerQuery(routerId)}`),
  cookies: (routerId?: string) =>
    api.get<HotspotCookie[]>(`/hotspot/cookies${routerQuery(routerId)}`),
  deleteCookie: (id: string, routerId?: string) =>
    api.delete<void>(`/hotspot/cookies/${encodeURIComponent(id)}${routerQuery(routerId)}`),
  /** Ce que le routeur porte réellement, par opposition à ce que la base suit. */
  stock: (routerId?: string) =>
    api.get<StockRouteur>(`/hotspot/stock${routerQuery(routerId)}`),
  /**
   * Pose la durée de l'offre en plafond sur les comptes qui n'en ont pas.
   *
   * `appliquer` à faux — le défaut — ne touche à rien et rend seulement ce
   * qui changerait.
   */
  plafonds: (routerId?: string, appliquer = false) =>
    api.post<RapportPlafonds>(
      `/hotspot/plafonds${routerQuery(routerId)}${routerQuery(routerId) ? '&' : '?'}apply=${appliquer}`,
      {},
    ),
  cutAccess: (username: string, routerId?: string) =>
    api.post<Coupure>(
      `/hotspot/cut-access/${encodeURIComponent(username)}${routerQuery(routerId)}`,
    ),
  sessions: (routerId?: string) =>
    api.get<SessionView[]>(`/hotspot/sessions${routerQuery(routerId)}`),
};

export function formatVolume(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} Go`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} Mo`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${bytes} o`;
}

export function formatUptime(seconds: number): string {
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)} j ${Math.floor((seconds % 86_400) / 3600)} h`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min`;
  return `${seconds} s`;
}

/**
 * Ce que la pose de plafonds ferait, ou a fait.
 *
 * `appliqué` à faux : rien n'a été écrit sur le routeur, `aCorriger` dit
 * seulement ce qui changerait.
 */
export interface RapportPlafonds {
  appliqué: boolean;
  aCorriger: { username: string; profil: string; plafondSecondes: number }[];
  ignorés: { username: string; profil: string; motif: string }[];
  corrigés: number;
  échecs: { username: string; motif: string }[];
}

