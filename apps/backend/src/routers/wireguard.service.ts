import { Injectable, Logger } from '@nestjs/common';
import { estPrivee } from '../common/adresses-locales.js';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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
  /**
   * Le fichier `.conf` du tunnel, quand le serveur peut l'écrire.
   *
   * Sur Windows, `wg set` demande les droits administrateur que la console
   * n'a pas. Mais écrire un fichier, elle sait faire — et cela retire l'étape
   * qui échouait vraiment : ouvrir un bloc-notes, coller quatre lignes au bon
   * endroit, enregistrer. Il ne reste alors qu'un aller-retour dans
   * l'application.
   */
  configPath: string;
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
      configPath: config.get<string>('WIREGUARD_CONFIG_PATH') ?? '',
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
    // Un nom de domaine est présumé public : `estPrivee` le rend faux sans
    // le résoudre, et se tromper dans ce sens ne fait qu'omettre un
    // avertissement.
    //
    // La meme definition que `adressePerimee`, et volontairement partagee :
    // deux copies de « qu'est-ce qu'une adresse privee » finiraient par
    // diverger, et l'une des deux se tromperait sans qu'on sache laquelle.
    return estPrivee(hôte);
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
  async addPeer(
    peer: PeerToAdd,
    etiquette?: string,
  ): Promise<{ applied: boolean; command: string; ecritDansLeFichier: boolean }> {
    const command = [
      'wg set',
      this.settings.interfaceName,
      'peer',
      peer.publicKey,
      'allowed-ips',
      `${peer.tunnelAddress}/32`,
    ].join(' ');

    if (!this.settings.managed) {
      // À défaut de piloter `wg`, écrire le fichier. C'est la marche de
      // l'escalier qui manquait : la console **affichait** un bloc à recopier
      // à la main dans un fichier, hors du produit, et cette étape échouait
      // tous les coups — quatre fois sur ce parc, sans que rien ne le dise
      // autrement que par un << Timeout 5000ms >> qui décrit un routeur
      // éteint.
      const ecrit = this.ecrirePairDansLeFichier(peer, etiquette);
      if (!ecrit) {
        this.logger.warn(`Pair WireGuard à ajouter à la main sur le serveur : ${command}`);
      }
      return { applied: false, command, ecritDansLeFichier: ecrit };
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
    return { applied: true, command, ecritDansLeFichier: false };
  }

  /**
   * Écrit le pair dans le `.conf` du tunnel, si le serveur sait où il est.
   *
   * **Remplace au lieu d'ajouter.** Un routeur reraccordé arrive avec une
   * nouvelle clé ou une nouvelle adresse ; empiler les blocs laisserait des
   * pairs morts que WireGuard accepte sans broncher, et dont on ne saurait
   * plus lequel est vivant. Un bloc portant la même clé **ou** la même
   * adresse est donc retiré avant.
   *
   * Ne lève jamais : un fichier absent, en lecture seule ou tenu par un autre
   * programme ne doit pas faire échouer un raccordement qui, lui, a réussi.
   * L'appelant apprend seulement que l'écriture n'a pas eu lieu, et la console
   * redemande alors le geste manuel.
   *
   * **Le tunnel qui tourne ne relit pas ce fichier.** Sur Windows, l'application
   * en garde sa propre copie chiffrée depuis l'import ; sur Linux, `wg-quick`
   * le lit au démarrage. Dans les deux cas il faut un aller-retour — c'est ce
   * que la console doit dire, et non << injoignable >>.
   */
  private ecrirePairDansLeFichier(peer: PeerToAdd, etiquette?: string): boolean {
    const chemin = this.settings.configPath;
    if (!chemin) return false;

    try {
      const avant = readFileSync(chemin, 'utf8');
      const blocs = decouperEnBlocs(avant);
      const survivants = blocs.pairs.filter(
        (bloc) =>
          !bloc.includes(peer.publicKey) && !bloc.includes(`${peer.tunnelAddress}/32`),
      );

      const nouveau = [
        `# ${etiquette ?? 'Routeur'} — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        '#',
        '# AllowedIPs en /32 : ce pair ne reçoit que ce qui lui est destiné. Une',
        '# plage plus large ferait passer par lui le trafic des autres routeurs.',
        '[Peer]',
        `PublicKey = ${peer.publicKey}`,
        `AllowedIPs = ${peer.tunnelAddress}/32`,
      ].join('\n');

      const apres = [blocs.interface.trimEnd(), '', ...survivants, nouveau, ''].join('\n');
      writeFileSync(chemin, apres, 'utf8');
      this.logger.log(`Pair écrit dans ${chemin} : ${peer.tunnelAddress}`);
      return true;
    } catch (error) {
      this.logger.error(`Pair non écrit dans ${chemin} : ${String(error)}`);
      return false;
    }
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

/**
 * Sépare l'interface de ses pairs, en gardant les commentaires de chacun.
 *
 * Les lignes qui précèdent un `[Peer]` lui appartiennent : elles disent
 * quel routeur c'est et depuis quand. Les rattacher au bloc plutôt qu'à
 * l'interface évite qu'un pair retiré laisse derrière lui l'épitaphe d'un
 * routeur qui n'est plus là.
 */
function decouperEnBlocs(contenu: string): { interface: string; pairs: string[] } {
  const lignes = contenu.split(/\r?\n/);
  const debuts: number[] = [];
  lignes.forEach((ligne, i) => {
    if (/^\s*\[Peer\]\s*$/i.test(ligne)) debuts.push(i);
  });
  if (debuts.length === 0) return { interface: contenu, pairs: [] };

  /** Le commentaire juste au-dessus d'un `[Peer]` fait partie de ce pair. */
  const remonter = (depuis: number, limite: number): number => {
    let i = depuis;
    while (i > limite && /^\s*(#.*)?$/.test(lignes[i - 1]!)) i -= 1;
    return i;
  };

  const bornes = debuts.map((debut, rang) => remonter(debut, rang === 0 ? 0 : debuts[rang - 1]!));
  const pairs = bornes.map((debut, rang) =>
    lignes.slice(debut, bornes[rang + 1] ?? lignes.length).join('\n').trim(),
  );
  return { interface: lignes.slice(0, bornes[0]).join('\n'), pairs: pairs.filter(Boolean) };
}
