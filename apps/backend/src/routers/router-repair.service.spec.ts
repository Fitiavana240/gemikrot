import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditResult } from '@prisma/client';
import { MockMikrotikService } from '@wifitati/mikrotik-service/tests/mocks/mock-mikrotik.service';
import { RouterRepairService } from './router-repair.service.js';

const ROUTEUR = 'routeur-1';

/**
 * Le cœur de ce service n'est pas l'écriture — c'est la relecture.
 *
 * Les formes de requête de `setUserManagerSettings` et `enablePackage` n'ont
 * pas pu être éprouvées contre un routeur réel : l'outillage refuse
 * l'écriture depuis ce poste. Cinq correspondances de ce projet écrites sur
 * la seule documentation se sont révélées fausses au contact du matériel.
 * Le service ne doit donc jamais déclarer un succès sur l'absence d'erreur.
 */
describe('RouterRepairService', () => {
  let mikrotik: MockMikrotikService;
  let audit: { log: ReturnType<typeof vi.fn> };
  let service: RouterRepairService;

  beforeEach(() => {
    mikrotik = new MockMikrotikService();
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
    mikrotik.umIgnoreLesEcritures = true;

    const résultat = await service.appliquer(ROUTEUR, 'allumer-service', 'admin-1');

    expect(résultat.appliquee).toBe(false);
    expect(résultat.message).toContain('/user-manager/set enabled=yes');
    expect(résultat.etat.serviceEnabled).toBe(false);
  });

  it('journalise un échec silencieux comme un échec, pas comme un succès', async () => {
    mikrotik.umIgnoreLesEcritures = true;
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
    mikrotik.umEtat.paquetProgramme = 'disable';

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
