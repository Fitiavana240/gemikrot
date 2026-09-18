import {
  mapUserManagerProfile,
  mapUserManagerUserProfile,
} from '../../src/mappers/user-manager.mapper';

/**
 * Charges utiles relevées telles quelles sur un hAP ac² en RouterOS 7.24.4.
 * Le modèle a été construit à partir de suppositions au départ ; ces tests
 * l'ancrent désormais sur ce que le routeur envoie vraiment.
 */
describe('mappers User Manager', () => {
  describe('profil (offre)', () => {
    it('lit la validité calendaire portée par le profil lui-même', () => {
      const profile = mapUserManagerProfile({
        '.id': '*2',
        comment: 'Ticket-1500Ar-30j',
        name: 'Ticket-1500Ar-30j',
        'name-for-users': 'Ticket-1500Ar-30j',
        'override-shared-users': 'off',
        price: '15000',
        'starts-when': 'first-auth',
        validity: '4w2d',
      });

      expect(profile.validityDurationSeconds).toBe(2_592_000);
      expect(profile.startsWhen).toBe('first-auth');
      expect(profile.price).toBe(15000);
      expect(profile.overrideSharedUsers).toBeNull();
    });

    it('traite "unlimited" comme une absence de validité, pas comme zéro', () => {
      const profile = mapUserManagerProfile({
        '.id': '*3',
        name: 'Admin',
        'override-shared-users': '5',
        'starts-when': 'assigned',
        validity: 'unlimited',
      });

      expect(profile.validityDurationSeconds).toBeNull();
      expect(profile.startsWhen).toBe('assigned');
      expect(profile.overrideSharedUsers).toBe(5);
    });
  });

  describe('attribution (abonnement en cours)', () => {
    it('lit l\'échéance calculée par le routeur', () => {
      const assignment = mapUserManagerUserProfile({
        '.id': '*1',
        'end-time': '2026-09-17 14:48:58',
        profile: 'TEST-1H',
        state: 'used',
        user: 'test1h',
      });

      expect(assignment.endTime).toBe('2026-09-17 14:48:58');
      expect(assignment.state).toBe('used');
    });

    it('ne fabrique pas de date quand la validité n\'a pas démarré', () => {
      // Cas réel d'un profil `first-auth` avant la première connexion.
      const assignment = mapUserManagerUserProfile({
        '.id': '*4',
        'end-time': 'not-yet-running',
        profile: '1Mois-15000Ar',
        state: 'waiting',
        user: 'ZZ-TEST-UM',
      });

      expect(assignment.endTime).toBeNull();
      expect(assignment.state).toBe('waiting');
    });

    it('traite "unlimited" comme une absence d\'échéance', () => {
      const assignment = mapUserManagerUserProfile({
        '.id': '*3',
        'end-time': 'unlimited',
        profile: 'Admin',
        state: 'running-active',
        user: 'Alexandre',
      });

      expect(assignment.endTime).toBeNull();
      expect(assignment.state).toBe('running-active');
    });
  });
});
