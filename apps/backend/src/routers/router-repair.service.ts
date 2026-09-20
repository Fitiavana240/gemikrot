import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { AuditResult } from '@prisma/client';
import type { IMikrotikService, UserManagerReadinessDto } from '@wifitati/mikrotik-service';
import { AuditService } from '../audit/audit.service.js';
import { MikrotikClientFactory } from './mikrotik-client.factory.js';

/**
 * Les réparations que la console sait appliquer elle-même.
 *
 * **Liste blanche nommée, et non passe-plat de commandes.** Une route qui
 * exécuterait une commande RouterOS arbitraire donnerait à tout ADMIN une
 * exécution de code à distance sur chaque routeur du parc — le tunnel
 * WireGuard, monté pour administrer, servirait alors à tout. Chaque
 * réparation est donc une entrée fixe : elle porte son geste, son critère de
 * réussite, et le problème qu'elle est censée résoudre.
 *
 * Trois choses en sont volontairement absentes : le redémarrage, le
 * déplacement de la base, et l'effacement de fichiers. Les deux premières
 * touchent des clients ou des tickets déjà vendus, la troisième suppose de
 * savoir à quoi sert chaque fichier. Elles restent affichées comme commandes
 * à coller, avec leur explication.
 */
interface Reparation {
  /** Le constat que cette réparation est censée faire disparaître. */
  readonly constat: string;
  readonly libellé: string;
  /** Ce qu'on taperait dans WinBox — montré avant, et journalisé. */
  readonly commande: string;
  readonly appliquer: (service: IMikrotikService) => Promise<void>;
  /**
   * Le routeur est-il maintenant dans l'état voulu ?
   *
   * Relire plutôt que croire la réponse : les formes de requête de ce module
   * n'ont pas pu être éprouvées contre le matériel, et RouterOS répond
   * volontiers `200` à une écriture qu'il n'applique pas.
   */
  readonly vérifier: (état: UserManagerReadinessDto) => boolean;
  /** Vrai quand le succès ne se voit qu'après un redémarrage. */
  readonly différée?: boolean;
}

const RÉPARATIONS: Record<string, Reparation> = {
  'allumer-service': {
    constat: 'service-eteint',
    libellé: 'Allumer le service User Manager',
    commande: '/user-manager/set enabled=yes',
    appliquer: (s) => s.setUserManagerSettings({ enabled: true }),
    vérifier: (é) => é.serviceEnabled,
  },
  'activer-profils': {
    constat: 'profils-desactives',
    libellé: 'Activer les profils',
    commande: '/user-manager/set use-profiles=yes',
    appliquer: (s) => s.setUserManagerSettings({ useProfiles: true }),
    vérifier: (é) => é.useProfiles,
  },
  'annuler-desactivation': {
    constat: 'paquet-desactivation-programmee',
    libellé: 'Annuler la désactivation programmée',
    commande: '/system/package/unschedule user-manager',
    appliquer: (s) => s.unschedulePackage('user-manager'),
    // Le succès se voit tout de suite : `scheduled` redevient vide. Rien
    // n'attend le redémarrage, puisqu'il s'agit justement de l'empêcher.
    vérifier: (é) => é.packageScheduled !== 'disable',
  },
  'activer-paquet': {
    constat: 'paquet-desactive',
    libellé: 'Programmer l’activation du paquet',
    commande: '/system/package/enable user-manager',
    appliquer: (s) => s.enablePackage('user-manager'),
    // `packageEnabled` ne bascule qu'au redémarrage : c'est `scheduled` qui
    // porte la preuve que la demande a été enregistrée.
    vérifier: (é) => é.packageScheduled === 'enable',
    différée: true,
  },
};

/**
 * Les noms de champs restent sans accent : c'est la convention du fil dans
 * ce projet (`surSupportAmovible`, `parRacine`, `reparation`), et un `é` dans
 * une clé JSON finit toujours par coûter un encodage quelque part.
 */
export interface RésultatRéparation {
  /** Le routeur a-t-il réellement changé ? */
  appliquee: boolean;
  message: string;
  /** L'état relu après coup, pour que l'écran se rafraîchisse sans second appel. */
  etat: UserManagerReadinessDto;
}

@Injectable()
export class RouterRepairService {
  private readonly logger = new Logger(RouterRepairService.name);

  constructor(
    private readonly clients: MikrotikClientFactory,
    private readonly audit: AuditService,
  ) {}

  /** Ce que la console peut proposer, pour que le frontend ne devine pas. */
  listerRéparations() {
    return Object.entries(RÉPARATIONS).map(([code, r]) => ({
      code,
      constat: r.constat,
      libelle: r.libellé,
      commande: r.commande,
      differee: r.différée === true,
    }));
  }

  async appliquer(
    routerId: string,
    code: string,
    adminUserId?: string,
  ): Promise<RésultatRéparation> {
    const réparation = RÉPARATIONS[code];
    if (!réparation) throw new BadRequestException(`Réparation inconnue : ${code}`);

    const service = await this.clients.forRouter(routerId);
    const avant = await service.getUserManagerReadiness();

    // Refuser d'agir quand le problème n'est pas là. Un onglet resté ouvert
    // depuis une heure propose encore des réparations déjà faites ; les
    // rejouer écrirait un réglage que quelqu'un a peut-être changé exprès
    // entre-temps.
    if (!avant.constats.some((c) => c.code === réparation.constat)) {
      throw new ConflictException(
        `Ce problème n'est plus présent sur le routeur : ${réparation.libellé} n'a pas été appliqué.`,
      );
    }

    try {
      await réparation.appliquer(service);
    } catch (error) {
      await this.journaliser(routerId, code, adminUserId, AuditResult.FAILURE, {
        commande: réparation.commande,
        erreur: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const après = await service.getUserManagerReadiness();
    const appliquée = réparation.vérifier(après);

    await this.journaliser(routerId, code, adminUserId, appliquée ? AuditResult.SUCCESS : AuditResult.FAILURE, {
      commande: réparation.commande,
      appliquée,
    });

    if (!appliquée) {
      // Le cas qui justifie de relire : le routeur a répondu sans erreur et
      // n'a rien changé. L'annoncer comme un succès enverrait chercher la
      // panne ailleurs pendant des heures.
      this.logger.warn(
        `Réparation ${code} sans effet sur ${routerId} : le routeur a accepté la requête sans changer d'état`,
      );
      return {
        appliquee: false,
        message:
          `Le routeur a accepté la demande mais son état n'a pas changé. ` +
          `La commande « ${réparation.commande} » reste à passer dans le terminal.`,
        etat: après,
      };
    }

    return {
      appliquee: true,
      message: réparation.différée
        ? `${réparation.libellé} : enregistré. Rien ne changera avant le redémarrage du routeur.`
        : `${réparation.libellé} : fait.`,
      etat: après,
    };
  }

  private journaliser(
    routerId: string,
    code: string,
    adminUserId: string | undefined,
    result: AuditResult,
    payloadDiff: Record<string, unknown>,
  ) {
    return this.audit.log({
      adminUserId,
      routerId,
      action: 'REPAIR_USER_MANAGER',
      targetType: 'Router',
      targetId: routerId,
      result,
      payloadDiff: { reparation: code, ...payloadDiff },
    });
  }
}
