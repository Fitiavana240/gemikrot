import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface WireguardSettings {
  /** Adresse publique du serveur, telle que le routeur doit la joindre. */
  endpointHost: string;
  endpointPort: number;
  /** Clé publique du serveur, à inscrire dans le pair côté routeur. */
  publicKey: string;
  /** Réseau du tunnel, ex. `10.88.0.0/16`. */
  subnet: string;
  /** Adresse du serveur dans le tunnel, ex. `10.88.0.1`. */
  serverAddress: string;
  interfaceName: string;
  /** Faux tant que le serveur ne pilote pas `wg` lui-même (poste Windows, labo). */
  managed: boolean;
}

export interface PeerToAdd {
  publicKey: string;
  /** L'adresse /32 du routeur : c'est elle, et elle seule, qui est routée. */
  tunnelAddress: string;
}

/**
 * Côté serveur du tunnel.
 *
 * Le montage est volontairement dissymétrique : **le routeur appelle le
 * serveur**, jamais l'inverse. Un routeur derrière la 4G ou un NAT d'opérateur
 * n'a ni adresse fixe ni port ouvert ; exiger l'inverse condamnerait la moitié
 * du parc.
 *
 * Deux réglages ne sont pas facultatifs sur le serveur, et ne s'écrivent pas
 * ici parce qu'ils relèvent de l'hôte :
 *
 * 1. **Interdire le routage entre pairs** (`wg0` vers `wg0` rejeté en forward).
 *    Sans cette règle, le routeur d'un exploitant atteint l'administration du
 *    routeur d'un autre. C'est l'équivalent réseau du cloisonnement des
 *    données, et l'oubli le plus classique de ce montage.
 * 2. **Sauvegarder `/etc/wireguard` à part** du dump de la base.
 *
 * Quand le pilotage automatique est coupé — c'est le cas en développement, et
 * sur toute machine sans `wg` — le service ne fait pas semblant : il rend la
 * commande exacte à passer sur le serveur, et l'enrôlement la conserve pour
 * que la console l'affiche.
 */
@Injectable()
export class WireguardService {
  private readonly logger = new Logger(WireguardService.name);
  readonly settings: WireguardSettings;

  constructor(config: ConfigService) {
    this.settings = {
      endpointHost: config.get<string>('WIREGUARD_ENDPOINT_HOST') ?? '',
      endpointPort: Number(config.get<string>('WIREGUARD_ENDPOINT_PORT') ?? 51820),
      publicKey: config.get<string>('WIREGUARD_SERVER_PUBLIC_KEY') ?? '',
      subnet: config.get<string>('WIREGUARD_SUBNET') ?? '10.88.0.0/16',
      serverAddress: config.get<string>('WIREGUARD_SERVER_ADDRESS') ?? '10.88.0.1',
      interfaceName: config.get<string>('WIREGUARD_INTERFACE') ?? 'wg0',
      managed: config.get<string>('WIREGUARD_MANAGED') === 'true',
    };
  }

  /**
   * L'adresse que le routeur appellera est-elle privée ?
   *
   * Un routeur ne joint une adresse privée que s'il est sur le même réseau.
   * En développement c'est normal — le serveur tourne sur le poste, à côté du
   * routeur. Remis à un exploitant dont le routeur est ailleurs, le même
   * script échoue **en silence** : WireGuard n'a personne à qui parler, les
   * octets sortants montent, les entrants restent à zéro, et rien ne dit
   * pourquoi. Ce diagnostic a déjà coûté une heure sur ce projet ; autant
   * que la console le pose avant, pas après.
   */
  get endpointPrive(): boolean {
    const hôte = this.settings.endpointHost.trim();
    if (hôte === '') return false;
    // Un nom de domaine est présumé public : on ne le résout pas, et se
    // tromper dans ce sens ne fait qu'omettre un avertissement.
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hôte)) return false;

    const [a, b] = hôte.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      // Lien-local : ce que rend une machine sans bail DHCP.
      (a === 169 && b === 254)
    );
  }

  /** Ce qui manque pour qu'un enrôlement soit possible, en clair. */
  missingConfiguration(): string[] {
    const missing: string[] = [];
    if (!this.settings.endpointHost) missing.push('WIREGUARD_ENDPOINT_HOST');
    if (!this.settings.publicKey) missing.push('WIREGUARD_SERVER_PUBLIC_KEY');
    return missing;
  }

  /**
   * Ajoute le pair et renvoie la commande équivalente.
   *
   * Elle est renvoyée dans les deux cas — appliquée ou non. Quand elle l'a
   * été, c'est une trace ; quand elle ne l'a pas été, c'est la consigne.
   */
  async addPeer(peer: PeerToAdd): Promise<{ applied: boolean; command: string }> {
    const command = [
      'wg set',
      this.settings.interfaceName,
      'peer',
      peer.publicKey,
      'allowed-ips',
      `${peer.tunnelAddress}/32`,
    ].join(' ');

    if (!this.settings.managed) {
      this.logger.warn(`Pair WireGuard à ajouter à la main sur le serveur : ${command}`);
      return { applied: false, command };
    }

    await run('wg', [
      'set',
      this.settings.interfaceName,
      'peer',
      peer.publicKey,
      'allowed-ips',
      `${peer.tunnelAddress}/32`,
    ]);
    // Sans sauvegarde, le pair disparaît au redémarrage de l'interface et le
    // routeur devient injoignable sans que rien ne l'explique.
    await run('sh', ['-c', `wg-quick save ${this.settings.interfaceName}`]).catch((error) =>
      this.logger.error(`Configuration WireGuard non sauvegardée : ${String(error)}`),
    );

    this.logger.log(`Pair ajouté : ${peer.tunnelAddress}`);
    return { applied: true, command };
  }

  /** Retire un pair. Un routeur retiré doit cesser d'atteindre le serveur. */
  async removePeer(publicKey: string): Promise<void> {
    if (!this.settings.managed) {
      this.logger.warn(
        `Pair WireGuard à retirer à la main : wg set ${this.settings.interfaceName} peer ${publicKey} remove`,
      );
      return;
    }
    await run('wg', ['set', this.settings.interfaceName, 'peer', publicKey, 'remove']);
    await run('sh', ['-c', `wg-quick save ${this.settings.interfaceName}`]).catch(() => undefined);
  }
}
