import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditResult } from '@prisma/client';
import type { UserManagerReadinessDto } from '@wifitati/mikrotik-service';
import { RouterRepairService } from './router-repair.service.js';

const ROUTEUR = 'routeur-1';

/**
 * Un routeur de laboratoire, réduit à ce que le service de réparation touche.
 *
 * Il tenait d'abord au simulacre du paquet MikroTik, atteint par son dossier
 * `tests/` — ce que `tsc` refuse de résoudre et que le backend n'a de toute
 * façon rien à faire : dépendre des internes de test d'un autre espace de
 * travail, c'est se lier à ce qui n'est pas un contrat.
 *
 * Il sait aussi **refuser de changer** tout en répondant sans erreur : c'est
 * le comportement qui a réellement mordu (`PATCH /rest/user-manager` rendait
 * 500, et une autre forme aurait pu rendre 200 sans rien faire).
 */
class RouteurDeLabo {
  etat = { serviceEnabled: false, useProfiles: false, programme: '' as '' | 'enable' | 'disable' };
  /** Quand c'est vrai, les écritures sont acceptées puis ignorées. */
  ignoreLesEcritures = false;

  async getUserManagerReadiness(): Promise<UserManagerReadinessDto> {
    const constats: UserManagerReadinessDto['constats'] = [];
    if (!this.etat.serviceEnabled) {
      constats.push({
        code: 'service-eteint',
        niveau: 'bloquant',
        titre: 'Le service User Manager est éteint',
        detail: '',
        commande: '/user-manager/set enabled=yes',
        reparation: 'allumer-service',
      });
    }
    if (!this.etat.useProfiles) {
      constats.push({
        code: 'profils-desactives',
        niveau: 'avertissement',
        titre: 'Les profils sont désactivés',
        detail: '',
        commande: '/user-manager/set use-profiles=yes',
        reparation: 'activer-profils',
      });
    }
    if (this.etat.programme === 'disable') {
      constats.push({
        code: 'paquet-desactivation-programmee',
        niveau: 'bloquant',
        titre: 'Désactivation programmée au prochain démarrage',
        detail: '',
        commande: '/system/package/unschedule user-manager',
        reparation: 'annuler-desactivation',
      });
    } else if (this.etat.programme === '') {
      constats.push({
        code: 'paquet-desactive',
        niveau: 'bloquant',
        titre: 'Le paquet est installé mais désactivé',
        detail: '',
        commande: '/system/package/enable user-manager',
        reparation: 'activer-paquet',
      });
    }

    return {
      packageInstalled: true,
      packageAvailable: false,
      packageEnabled: false,
      packageVersion: '7.24.4',
      packageSizeBytes: 344209,
      packageScheduled: this.etat.programme || null,
      serviceEnabled: this.etat.serviceEnabled,
      useProfiles: this.etat.useProfiles,
      database: null,
      internalFreeBytes: 286720,
      internalTotalBytes: 16777216,
      disks: [],
      constats,
    };
  }

  async setUserManagerSettings(payload: { enabled?: boolean; useProfiles?: boolean }) {
    if (this.ignoreLesEcritures) return;
    if (payload.enabled !== undefined) this.etat.serviceEnabled = payload.enabled;
    if (payload.useProfiles !== undefined) this.etat.useProfiles = payload.useProfiles;
  }

  async enablePackage() {
    if (this.ignoreLesEcritures) return;
    this.etat.programme = 'enable';
  }

  async unschedulePackage() {
    if (this.ignoreLesEcritures) return;
    this.etat.programme = '';
  }
}

/**
 * Le cœur de ce service n'est pas l'écriture — c'est la relecture.
 *
 * Ce n'est pas une précaution théorique : `PATCH /rest/user-manager`, écrit
 * d'après la convention du reste du code, a rendu **500** sur le hAP le
 * 2026-09-20. La bonne forme est `POST /rest/user-manager/set`, un menu
 * singleton n'ayant pas d'élément à viser. Sans la relecture, la console
 * aurait affiché un succès et renvoyé chercher la panne ailleurs.
 *
 * Le service ne doit donc jamais conclure au succès sur l'absence d'erreur.
 */
describe('RouterRepairService', () => {
  let mikrotik: RouteurDeLabo;
  let audit: { log: ReturnType<typeof vi.fn> };
  let service: RouterRepairService;

  beforeEach(() => {
    mikrotik = new RouteurDeLabo();
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    service = new RouterRepairService(
      { forRouter: async () => mikrotik } as never,
      audit as never,
    );
  });

  it('allume le service et le constate sur le routeur', async () => {
    const résultat = await service.appliquer(ROUTEUR, 'allumer-service', 'admin-1');

    expect(résultat.appliquee).toBe(true);
    expect(résultat.etat.serviceEnabled).toBe(true);
    // L'état relu accompagne la réponse : l'écran se rafraîchit sans second appel.
    expect(résultat.etat.constats.some((c) => c.code === 'service-eteint')).toBe(false);
  });

  it("dit la vérité quand le routeur accepte et n'applique rien", async () => {
    // Le cas qui justifie toute la relecture : RouterOS répond volontiers
    // `200` à une écriture dont la forme ne lui convient pas, et ne change
    // rien. Annoncer un succès enverrait chercher la panne ailleurs.
    mikrotik.ignoreLesEcritures = true;

    const résultat = await service.appliquer(ROUTEUR, 'allumer-service', 'admin-1');

    expect(résultat.appliquee).toBe(false);
    expect(résultat.message).toContain('/user-manager/set enabled=yes');
    expect(résultat.etat.serviceEnabled).toBe(false);
  });

  it('journalise un échec silencieux comme un échec, pas comme un succès', async () => {
    mikrotik.ignoreLesEcritures = true;
    await service.appliquer(ROUTEUR, 'allumer-service', 'admin-1');

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REPAIR_USER_MANAGER',
        result: AuditResult.FAILURE,
        adminUserId: 'admin-1',
        routerId: ROUTEUR,
      }),
    );
  });

  it("juge l'activation d'un paquet sur `scheduled`, pas sur `disabled`", async () => {
    // Un changement de paquet ne prend effet qu'au redémarrage : `disabled`
    // reste vrai. Vérifier ce champ déclarerait en échec une réparation
    // parfaitement réussie.
    const résultat = await service.appliquer(ROUTEUR, 'activer-paquet', 'admin-1');

    expect(résultat.appliquee).toBe(true);
    expect(résultat.etat.packageEnabled).toBe(false);
    expect(résultat.etat.packageScheduled).toBe('enable');
    expect(résultat.message).toContain('redémarrage');
  });

  it('annule une désactivation programmée, sans attendre de redémarrage', async () => {
    // Le cas sournois : le service tourne encore, et mourrait au prochain
    // démarrage. L'annulation, elle, se constate tout de suite.
    mikrotik.etat.programme = 'disable';

    const résultat = await service.appliquer(ROUTEUR, 'annuler-desactivation', 'admin-1');

    expect(résultat.appliquee).toBe(true);
    expect(résultat.etat.packageScheduled).toBeNull();
    expect(résultat.message).not.toContain('redémarrage');
  });

  it("refuse une réparation dont le problème n'est plus là", async () => {
    await service.appliquer(ROUTEUR, 'allumer-service', 'admin-1');

    // Un onglet resté ouvert propose encore la réparation déjà faite. La
    // rejouer réécrirait un réglage que quelqu'un a pu changer exprès.
    await expect(service.appliquer(ROUTEUR, 'allumer-service', 'admin-1')).rejects.toThrow(
      /n'est plus présent/,
    );
  });

  it('refuse un code inconnu sans toucher au routeur', async () => {
    // La liste blanche est la seule porte : un code libre deviendrait une
    // exécution de commande à distance sur chaque routeur du parc.
    await expect(service.appliquer(ROUTEUR, '/system/reboot', 'admin-1')).rejects.toThrow(
      /inconnue/,
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('ne propose aucune réparation qui touche des clients ou des tickets', () => {
    const codes = service.listerRéparations().map((r) => r.code);

    expect(codes).toEqual([
      'allumer-service',
      'activer-profils',
      'annuler-desactivation',
      'activer-paquet',
    ]);
    // Redémarrer, déplacer la base, effacer des fichiers : affichés comme
    // commandes à coller, jamais comme boutons.
    expect(codes).not.toContain('redemarrer');
    expect(codes).not.toContain('deplacer-base');
  });

  it('remonte une erreur du routeur au lieu de la maquiller', async () => {
    mikrotik.setUserManagerSettings = async () => {
      throw new Error('connexion refusée');
    };

    await expect(service.appliquer(ROUTEUR, 'allumer-service', 'admin-1')).rejects.toThrow(
      'connexion refusée',
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ result: AuditResult.FAILURE }),
    );
  });
});
