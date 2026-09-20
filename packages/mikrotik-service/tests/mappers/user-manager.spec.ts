import {
  mapUserManagerProfile,
  mapUserManagerSession,
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

    /**
     * Relevé sur le hAP en 7.24.4, et pas deviné.
     *
     * RouterOS résout `user` en nom tant que le compte existe, et rend
     * l'identifiant brut — `*10` — une fois qu'il a disparu ; il n'efface pas
     * les attributions pour autant. Dix-huit d'entre elles ont survécu à leurs
     * comptes sur ce parc, et la console écrivait `*10` dans la colonne
     * « Compte » comme si c'était un nom — tout en les comptant comme des
     * comptes sur l'écran Profils, qui annonçait « 16 » pour seize fantômes.
     */
    it('reconnait une attribution dont le compte a disparu', () => {
      const orpheline = mapUserManagerUserProfile({
        '.id': '*1A',
        'end-time': 'unlimited',
        profile: '4Heure-1000Ar',
        state: 'waiting',
        user: '*10',
      });

      expect(orpheline.usernameIntrouvable).toBe(true);
      // Le nom brut est conservé : c'est la seule trace de ce qui manque.
      expect(orpheline.username).toBe('*10');
    });

    it('ne prend pas un vrai nom pour une reference morte', () => {
      // Un nom de compte ne peut pas avoir la forme d'un `.id` RouterOS, mais
      // se tromper ici ferait disparaître des comptes vivants de l'écran.
      for (const nom of ['test1h', 'ZZG-D8SXHVKSH6', 'Alexandre', '2B49DQZY59']) {
        const vivante = mapUserManagerUserProfile({ user: nom, profile: 'p', state: 'waiting' });
        expect(vivante.usernameIntrouvable).toBe(false);
      }
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

/**
 * Charge utile d'une session, relevée telle quelle sur le hAP. La première
 * version du mapper lisait `start-time`, `stop-time` et `session-time` —
 * trois champs qui n'existent pas : toutes les sessions ressortaient vides,
 * à zéro seconde, et jamais terminées.
 */
describe('mapper de session User Manager', () => {
  const RAW = {
    '.id': '*1',
    'acct-session-id': '80401105',
    active: 'false',
    'calling-station-id': 'BC:1D:89:91:4A:5E',
    download: '92325484',
    ended: '2026-09-17 14:18:15',
    'nas-ip-address': '127.0.0.1',
    started: '2026-09-17 13:48:58',
    'terminate-cause': 'lost-service',
    upload: '47093621',
    uptime: '29m18s',
    user: 'test1h',
  };

  it('lit les champs que le routeur envoie vraiment', () => {
    const session = mapUserManagerSession(RAW);

    expect(session.username).toBe('test1h');
    expect(session.startTime).toBe('2026-09-17 13:48:58');
    expect(session.stopTime).toBe('2026-09-17 14:18:15');
    expect(session.sessionTimeSeconds).toBe(29 * 60 + 18);
    expect(session.bytesIn).toBe(92_325_484);
    expect(session.bytesOut).toBe(47_093_621);
    expect(session.terminateCause).toBe('lost-service');
  });

  it("prend l'état actif du routeur plutôt que de le déduire", () => {
    // Une session close dont la date de fin manquerait passerait sinon pour
    // encore en cours.
    expect(mapUserManagerSession(RAW).active).toBe(false);
    expect(mapUserManagerSession({ ...RAW, active: 'true', ended: null }).active).toBe(true);
  });
});
