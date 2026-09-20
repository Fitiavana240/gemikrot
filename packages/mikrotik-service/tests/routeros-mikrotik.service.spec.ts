import { RouterOSMikrotikService } from '../src/routeros-mikrotik.service';
import { MikrotikConflictError, MikrotikNotFoundError, MikrotikValidationError } from '../src/errors/mikrotik.errors';
import { createMockRestClient, MockRestClient } from './mocks/mock-routeros-rest-client';
import { createSilentLogger } from './mocks/silent-logger';

describe('RouterOSMikrotikService', () => {
  let client: MockRestClient;
  let service: RouterOSMikrotikService;

  beforeEach(() => {
    client = createMockRestClient();
    service = new RouterOSMikrotikService(client as any, createSilentLogger());
  });

  describe('getSystemResource', () => {
    it('mappe correctement les champs kebab-case RouterOS vers le DTO', async () => {
      client.get.mockResolvedValueOnce({
        uptime: '1d02:03:04',
        version: '7.24.4',
         'build-time': '2025-01-01 00:00:00',
        'cpu-load': '7',
        'free-memory': '104857600',
        'total-memory': '268435456',
        'board-name': 'hAP ac2',
      });

      const result = await service.getSystemResource();

      expect(result.cpuLoadPercent).toBe(7);
      expect(result.freeMemoryBytes).toBe(104857600);
      expect(result.boardName).toBe('hAP ac2');
      expect(client.get).toHaveBeenCalledWith('/system/resource');
    });
  });

  describe('getHotspotActiveUsers', () => {
    it('mappe la liste et convertit les durées RouterOS en secondes', async () => {
      client.get.mockResolvedValueOnce([
        {
          '.id': '*1',
          user: 'client01',
          address: '10.5.50.10',
          'mac-address': 'AA:BB:CC:DD:EE:FF',
          uptime: '00:05:30',
          'idle-time': '00:00:10',
          'bytes-in': '1000',
          'bytes-out': '2000',
          'login-by': 'HTTP-CHAP',
        },
      ]);

      const result = await service.getHotspotActiveUsers();

      expect(result).toHaveLength(1);
      expect(result[0].username).toBe('client01');
      expect(result[0].uptimeSeconds).toBe(330);
      expect(result[0].bytesOut).toBe(2000);
    });
  });

  describe('createUserManagerUser', () => {
    it("rejette un nom d'utilisateur invalide avant tout appel réseau", async () => {
      await expect(
        service.createUserManagerUser({ username: 'a', password: '1234' }),
      ).rejects.toBeInstanceOf(MikrotikValidationError);

      expect(client.get).not.toHaveBeenCalled();
      expect(client.put).not.toHaveBeenCalled();
    });

    it("lève un conflit si l'utilisateur existe déjà", async () => {
      client.get.mockResolvedValueOnce([{ '.id': '*1', name: 'client01' }]);

      await expect(
        service.createUserManagerUser({ username: 'client01', password: 'secret123' }),
      ).rejects.toBeInstanceOf(MikrotikConflictError);

      expect(client.put).not.toHaveBeenCalled();
    });

    it('crée l\'utilisateur et retourne le DTO mappé quand tout est valide', async () => {
      client.get.mockResolvedValueOnce([]); // aucun utilisateur existant
      client.put.mockResolvedValueOnce({
        '.id': '*2',
        name: 'client02',
        'shared-users': '1',
      });

      const result = await service.createUserManagerUser({
        username: 'client02',
        password: 'secret123',
      });

      expect(result.username).toBe('client02');
      expect(client.put).toHaveBeenCalledWith(
        '/user-manager/user',
        expect.objectContaining({ name: 'client02', password: 'secret123' }),
      );
    });
  });

  describe('deleteUserManagerUser', () => {
    it("lève MikrotikNotFoundError si l'utilisateur n'existe pas", async () => {
      client.get.mockResolvedValueOnce([]);

      await expect(service.deleteUserManagerUser('inconnu')).rejects.toBeInstanceOf(MikrotikNotFoundError);
      expect(client.delete).not.toHaveBeenCalled();
    });

    it('supprime l\'utilisateur existant via son id RouterOS', async () => {
      client.get
        .mockResolvedValueOnce([{ '.id': '*5', name: 'client05' }])
        .mockResolvedValueOnce([]);

      await service.deleteUserManagerUser('client05');

      expect(client.delete).toHaveBeenCalledWith('/user-manager/user/*5');
    });

    it('retire les attributions avant le compte', async () => {
      // RouterOS ne les efface pas : il y remplace le nom du compte par son
      // identifiant interne, et le profil se croit alors utilisé pour
      // toujours par un compte qui n'existe plus.
      client.get
        .mockResolvedValueOnce([{ '.id': '*5', name: 'client05' }])
        .mockResolvedValueOnce([
          { '.id': '*9', user: 'client05', profile: 'OFFRE', state: 'used' },
        ]);

      await service.deleteUserManagerUser('client05');

      expect(client.delete).toHaveBeenNthCalledWith(1, '/user-manager/user-profile/*9');
      expect(client.delete).toHaveBeenNthCalledWith(2, '/user-manager/user/*5');
    });
  });

  describe('pruneOrphanAssignments', () => {
    it('retire les attributions dont le compte a disparu', async () => {
      client.get
        .mockResolvedValueOnce([
          { '.id': '*1', user: 'vivant', profile: 'OFFRE', state: 'used' },
          { '.id': '*2', user: '*6', profile: 'OFFRE', state: 'waiting' },
        ])
        .mockResolvedValueOnce([{ '.id': '*5', name: 'vivant' }]);

      const removed = await service.pruneOrphanAssignments();

      expect(removed).toBe(1);
      expect(client.delete).toHaveBeenCalledTimes(1);
      expect(client.delete).toHaveBeenCalledWith('/user-manager/user-profile/*2');
    });
  });

  describe('disconnectHotspotUser', () => {
    it('appelle le bon endpoint de déconnexion', async () => {
      await service.disconnectHotspotUser({ sessionId: '*7' });
      expect(client.delete).toHaveBeenCalledWith('/ip/hotspot/active/*7');
    });

    it('rejette un sessionId vide sans appeler RouterOS', async () => {
      await expect(service.disconnectHotspotUser({ sessionId: '' })).rejects.toBeInstanceOf(
        MikrotikValidationError,
      );
      expect(client.delete).not.toHaveBeenCalled();
    });
  });

  describe('updateHotspotProfile', () => {
    /**
     * Le piège le plus sournois relevé sur ce routeur.
     *
     * Éprouvé sur le hAP en 7.24.4, trois requêtes de suite :
     *
     * | Envoyé | Relu |
     * |---|---|
     * | `add-mac-cookie=false` seul | `false` |
     * | avec `shared-users` et `idle-timeout` | `false` |
     * | **avec `mac-cookie-timeout`** | **`true`** |
     *
     * Régler la durée de vie du cookie **réactive le cookie**, sans erreur.
     * Un exploitant qui décocherait la case en ajustant la durée obtiendrait
     * donc l'inverse de ce qu'il demande. Le drapeau part seul, et en dernier.
     */
    it('envoie add-mac-cookie seul, après les autres champs', async () => {
      client.get.mockResolvedValueOnce([{ '.id': '*1', name: 'P' }]);
      client.patch.mockResolvedValue({ '.id': '*1', name: 'P', 'add-mac-cookie': 'false' });

      await service.updateHotspotProfile({
        name: 'P',
        sharedUsers: 2,
        macCookieTimeoutSeconds: 1800,
        addMacCookie: false,
      });

      expect(client.patch).toHaveBeenCalledTimes(2);
      const [, premier] = client.patch.mock.calls[0];
      const [, second] = client.patch.mock.calls[1];
      // Le premier porte tout le reste, le second le seul drapeau.
      expect(premier).toMatchObject({ 'shared-users': 2, 'mac-cookie-timeout': '1800s' });
      expect(premier['add-mac-cookie']).toBeUndefined();
      expect(second).toEqual({ 'add-mac-cookie': 'false' });
    });

    it("n'envoie pas de seconde requête quand le cookie n'est pas en cause", async () => {
      // Une requête de plus à chaque modification de débit serait du temps perdu
      // sur un routeur qui répond en centaines de millisecondes.
      client.get.mockResolvedValueOnce([{ '.id': '*1', name: 'P' }]);
      client.patch.mockResolvedValue({ '.id': '*1', name: 'P' });

      await service.updateHotspotProfile({ name: 'P', sharedUsers: 3 });

      expect(client.patch).toHaveBeenCalledTimes(1);
    });
  });

  describe('createProfile', () => {
    it('écrit la validité et starts-when sur le profil lui-même', async () => {
      client.get.mockResolvedValueOnce([]); // aucun profil existant
      // Réponse calquée sur celle d'un hAP en 7.24.4.
      client.put.mockResolvedValueOnce({
        '.id': '*9',
        name: 'forfait-30j',
        'name-for-users': 'forfait-30j',
        validity: '4w2d',
        'starts-when': 'first-auth',
        price: '15000',
        'override-shared-users': 'off',
      });

      const result = await service.createProfile({
        name: 'forfait-30j',
        validityDurationSeconds: 2_592_000,
        startsWhen: 'first-auth',
        price: 15000,
      });

      expect(result.name).toBe('forfait-30j');
      expect(result.validityDurationSeconds).toBe(2_592_000);
      expect(result.startsWhen).toBe('first-auth');
      expect(result.price).toBe(15000);
      expect(result.overrideSharedUsers).toBeNull();
      // La validité va sur /user-manager/profile, pas sur profile-limitation,
      // qui ne sert qu'à rattacher une limitation de débit.
      expect(client.put).toHaveBeenCalledWith(
        '/user-manager/profile',
        expect.objectContaining({ validity: '2592000s', 'starts-when': 'first-auth' }),
      );
    });

    it('refuse de créer un profil déjà présent', async () => {
      client.get.mockResolvedValueOnce([{ '.id': '*1', name: 'forfait-30j', validity: '4w2d' }]);

      await expect(
        service.createProfile({
          name: 'forfait-30j',
          validityDurationSeconds: 2_592_000,
          startsWhen: 'first-auth',
        }),
      ).rejects.toBeInstanceOf(MikrotikConflictError);
      expect(client.put).not.toHaveBeenCalled();
    });
  });

  describe('setUserManagerUserDisabled', () => {
    it('suspend un abonné sans supprimer son compte', async () => {
      client.get.mockResolvedValueOnce([{ '.id': '*5', name: 'Mario', disabled: 'false' }]);
      client.patch.mockResolvedValueOnce({ '.id': '*5', name: 'Mario', disabled: 'true' });

      const result = await service.setUserManagerUserDisabled('Mario', true);

      expect(result.disabled).toBe(true);
      expect(client.patch).toHaveBeenCalledWith('/user-manager/user/*5', { disabled: 'true' });
      expect(client.delete).not.toHaveBeenCalled();
    });
  });

  describe('updateUserManagerUser', () => {
    it('fait tourner le mot de passe sans toucher au reste du compte', async () => {
      client.get.mockResolvedValueOnce([{ '.id': '*5', name: 'Mario', 'shared-users': '2' }]);
      client.patch.mockResolvedValueOnce({ '.id': '*5', name: 'Mario', 'shared-users': '2' });

      await service.updateUserManagerUser({ username: 'Mario', password: 'NOUVEAU42' });

      // Seul le mot de passe part : `shared-users` et le commentaire ne
      // doivent pas être réécrits à leur valeur par défaut au passage.
      expect(client.patch).toHaveBeenCalledWith('/user-manager/user/*5', {
        password: 'NOUVEAU42',
      });
    });

    it('refuse un compte inexistant plutôt que de le créer', async () => {
      client.get.mockResolvedValueOnce([]);

      await expect(
        service.updateUserManagerUser({ username: 'fantome', password: 'abcd1234' }),
      ).rejects.toBeInstanceOf(MikrotikNotFoundError);
      expect(client.patch).not.toHaveBeenCalled();
      expect(client.put).not.toHaveBeenCalled();
    });
  });

  describe('deleteProfile', () => {
    it("refuse de supprimer un profil encore attribué", async () => {
      client.get
        .mockResolvedValueOnce([{ '.id': '*2', name: '1Mois', validity: '4w2d' }])
        .mockResolvedValueOnce([{ '.id': '*9', user: 'Mario', profile: '1Mois', state: 'used' }]);

      await expect(service.deleteProfile('1Mois')).rejects.toBeInstanceOf(MikrotikConflictError);
      expect(client.delete).not.toHaveBeenCalled();
    });

    it('supprime un profil libre de toute attribution', async () => {
      client.get
        .mockResolvedValueOnce([{ '.id': '*2', name: '1Mois', validity: '4w2d' }])
        .mockResolvedValueOnce([]);

      await service.deleteProfile('1Mois');

      expect(client.delete).toHaveBeenCalledWith('/user-manager/profile/*2');
    });
  });

  describe('createLimitation', () => {
    it('écrit les débits dans deux champs distincts, en bits par seconde', async () => {
      client.get.mockResolvedValueOnce([]);
      client.put.mockResolvedValueOnce({
        '.id': '*1',
        name: 'OFFRE-LIM',
        'rate-limit-rx': '2000000',
        'rate-limit-tx': '1000000',
        'transfer-limit': '1073741824',
        'uptime-limit': '1h',
      });

      const result = await service.createLimitation({
        name: 'OFFRE-LIM',
        rateLimitRxBitsPerSecond: 2_000_000,
        rateLimitTxBitsPerSecond: 1_000_000,
        transferLimitBytes: 1_073_741_824,
        uptimeLimitSeconds: 3600,
      });

      // Une limitation n'a pas de jeton « rx/tx » comme un profil HotSpot :
      // relevé sur un hAP en 7.24.4.
      expect(client.put).toHaveBeenCalledWith('/user-manager/limitation', {
        name: 'OFFRE-LIM',
        'rate-limit-rx': 2_000_000,
        'rate-limit-tx': 1_000_000,
        'transfer-limit': 1_073_741_824,
        'uptime-limit': '3600s',
      });
      expect(result.rateLimit.rxBitsPerSecond).toBe(2_000_000);
      expect(result.uptimeLimitSeconds).toBe(3600);
    });

    it('refuse un nom déjà pris', async () => {
      client.get.mockResolvedValueOnce([{ '.id': '*1', name: 'OFFRE-LIM' }]);

      await expect(
        service.createLimitation({ name: 'OFFRE-LIM', rateLimitRxBitsPerSecond: 1_000_000 }),
      ).rejects.toBeInstanceOf(MikrotikConflictError);
      expect(client.put).not.toHaveBeenCalled();
    });

    it('rejette un nom qui casserait le chemin REST', async () => {
      await expect(
        service.createLimitation({ name: 'offre/lim', rateLimitRxBitsPerSecond: 1_000_000 }),
      ).rejects.toBeInstanceOf(MikrotikValidationError);
      expect(client.get).not.toHaveBeenCalled();
      expect(client.put).not.toHaveBeenCalled();
    });
  });

  describe('updateLimitation', () => {
    it('lève un plafond avec zéro plutôt que de supprimer la limitation', async () => {
      client.get.mockResolvedValueOnce([
        { '.id': '*1', name: 'OFFRE-LIM', 'rate-limit-rx': '2000000' },
      ]);
      client.patch.mockResolvedValueOnce({ '.id': '*1', name: 'OFFRE-LIM', 'rate-limit-rx': '0' });

      const result = await service.updateLimitation({
        name: 'OFFRE-LIM',
        rateLimitRxBitsPerSecond: null,
      });

      expect(client.patch).toHaveBeenCalledWith('/user-manager/limitation/*1', {
        'rate-limit-rx': 0,
      });
      // Zéro côté RouterOS veut dire « aucune limite », pas « 0 bit/s ».
      expect(result.rateLimit.rxBitsPerSecond).toBeNull();
    });
  });

  describe('attachLimitationToProfile', () => {
    it('ne crée pas de doublon quand le rattachement existe déjà', async () => {
      client.get.mockResolvedValueOnce([
        { '.id': '*1', profile: '1Mois', limitation: 'OFFRE-LIM' },
      ]);

      const result = await service.attachLimitationToProfile({
        profileName: '1Mois',
        limitationName: 'OFFRE-LIM',
      });

      expect(result.id).toBe('*1');
      expect(client.put).not.toHaveBeenCalled();
    });

    it('crée le rattachement quand il est absent', async () => {
      client.get.mockResolvedValueOnce([]);
      client.put.mockResolvedValueOnce({
        '.id': '*3',
        profile: '1Mois',
        limitation: 'OFFRE-LIM',
      });

      await service.attachLimitationToProfile({
        profileName: '1Mois',
        limitationName: 'OFFRE-LIM',
      });

      expect(client.put).toHaveBeenCalledWith('/user-manager/profile-limitation', {
        profile: '1Mois',
        limitation: 'OFFRE-LIM',
      });
    });
  });

  describe('deleteLimitation', () => {
    it('refuse tant que la limitation est rattachée à un profil', async () => {
      client.get
        .mockResolvedValueOnce([{ '.id': '*1', name: 'OFFRE-LIM' }])
        .mockResolvedValueOnce([{ '.id': '*7', profile: '1Mois', limitation: 'OFFRE-LIM' }]);

      await expect(service.deleteLimitation('OFFRE-LIM')).rejects.toBeInstanceOf(
        MikrotikConflictError,
      );
      expect(client.delete).not.toHaveBeenCalled();
    });
  });

  /**
   * Le plafond de temps d'un compte HotSpot, éprouvé sur le hAP réel le
   * 2026-09-20 : compte d'essai créé, plafond retiré, compte supprimé, parc
   * ramené à ses 646 comptes.
   */
  describe('plafond de temps HotSpot', () => {
    it('écrit une durée et non un nombre', async () => {
      client.get.mockResolvedValueOnce([]);
      client.put.mockResolvedValueOnce({ '.id': '*1', name: 'H1' });

      await service.createHotspotUser({
        username: 'H1',
        password: 'x',
        profileName: '2Heure-500Ar',
        limitUptimeSeconds: 7200,
      });

      // Relevé : `7200s` est accepté et relu `2h` — le format même des 400
      // comptes du parc qui portent déjà un plafond.
      expect(client.put).toHaveBeenCalledWith(
        '/ip/hotspot/user',
        expect.objectContaining({ 'limit-uptime': '7200s' }),
      );
    });

    it("n'envoie aucun plafond quand il n'y en a pas", async () => {
      client.get.mockResolvedValueOnce([]);
      client.put.mockResolvedValueOnce({ '.id': '*1', name: 'H2' });

      await service.createHotspotUser({
        username: 'H2',
        password: 'x',
        profileName: 'default',
      });

      // Un `0s` à la création donnerait un compte épuisé d'avance.
      const corps = client.put.mock.calls[0][1] as Record<string, unknown>;
      expect(corps).not.toHaveProperty('limit-uptime');
    });

    it('retire un plafond avec `0s`, ce qui fait disparaître le champ', async () => {
      client.get.mockResolvedValueOnce([{ '.id': '*3E3', name: 'H3' }]);
      client.patch.mockResolvedValueOnce({ '.id': '*3E3', name: 'H3' });

      await service.updateHotspotUser({ username: 'H3', limitUptimeSeconds: null });

      // Vérifié sur le routeur : après `0s`, `limit-uptime` n'est plus rendu
      // du tout, exactement comme sur un compte qui n'en a jamais eu.
      expect(client.patch).toHaveBeenCalledWith('/ip/hotspot/user/*3E3', {
        'limit-uptime': '0s',
      });
    });

    it('ne touche pas au plafond quand on ne le mentionne pas', async () => {
      client.get.mockResolvedValueOnce([{ '.id': '*3E3', name: 'H4' }]);
      client.patch.mockResolvedValueOnce({ '.id': '*3E3', name: 'H4' });

      await service.updateHotspotUser({ username: 'H4', comment: 'Ticket 500Ar' });

      // `undefined` et `null` ne veulent pas dire la même chose : l'un se
      // tait, l'autre efface. Les confondre viderait le plafond d'un ticket
      // qu'on voulait seulement renommer.
      expect(client.patch).toHaveBeenCalledWith('/ip/hotspot/user/*3E3', {
        comment: 'Ticket 500Ar',
      });
    });
  });

  describe('updatePppSecret', () => {
    const COMPTE = {
      '.id': '*7',
      name: 'rakoto',
      profile: '1Mois',
      service: 'pppoe',
      disabled: 'false',
    };

    it("n'écrit que les champs fournis", async () => {
      client.get.mockResolvedValueOnce([COMPTE]);
      client.patch.mockResolvedValueOnce(COMPTE);

      await service.updatePppSecret('rakoto', { comment: 'déménagé' });

      // Le profil porte le débit. Un formulaire qui renverrait tout
      // l'écraserait avec ce qu'il avait chargé — et un changement fait
      // ailleurs entre-temps disparaîtrait sans bruit.
      expect(client.patch).toHaveBeenCalledWith('/ppp/secret/*7', { comment: 'déménagé' });
    });

    it('traduit les noms applicatifs en vocabulaire RouterOS', async () => {
      client.get.mockResolvedValueOnce([COMPTE]);
      client.patch.mockResolvedValueOnce(COMPTE);

      await service.updatePppSecret('rakoto', { remoteAddress: '10.0.0.5', profile: '3Mois' });

      expect(client.patch).toHaveBeenCalledWith('/ppp/secret/*7', {
        'remote-address': '10.0.0.5',
        profile: '3Mois',
      });
    });

    it('refuse une demande vide plutôt que de faire un appel pour rien', async () => {
      client.get.mockResolvedValueOnce([COMPTE]);

      await expect(service.updatePppSecret('rakoto', {})).rejects.toThrow(
        MikrotikValidationError,
      );
      expect(client.patch).not.toHaveBeenCalled();
    });

    it("refuse un compte inconnu au lieu d'en créer un", async () => {
      client.get.mockResolvedValueOnce([]);

      await expect(
        service.updatePppSecret('inconnu', { comment: 'x' }),
      ).rejects.toThrow(MikrotikNotFoundError);
      expect(client.patch).not.toHaveBeenCalled();
    });
  });

  /**
   * Les écritures sur les menus **singleton**, éprouvées sur le hAP réel le
   * 2026-09-20 — et d'abord de la mauvaise façon.
   *
   * `PATCH /rest/user-manager` rend **500 Internal Server Error** en 7.24.4.
   * Le PATCH vaut pour les collections (`/user-manager/user/<id>`), où il y a
   * un élément à viser ; un menu sans éléments veut la commande `set` en
   * POST. La forme se transpose mal, et rien dans la documentation ne le dit
   * assez fort pour qu'on s'en méfie.
   */
  describe('écritures sur les menus singleton', () => {
    it('pose les réglages User Manager par la commande `set`, et non par PATCH', async () => {
      client.post.mockResolvedValueOnce({});

      await service.setUserManagerSettings({ enabled: true, useProfiles: true });

      expect(client.post).toHaveBeenCalledWith('/user-manager/set', {
        enabled: 'yes',
        'use-profiles': 'yes',
      });
      // Le piège d'origine : un PATCH ici répond 500.
      expect(client.patch).not.toHaveBeenCalled();
    });

    it("n'écrit que ce qu'on lui demande", async () => {
      client.post.mockResolvedValueOnce({});

      await service.setUserManagerSettings({ useProfiles: false });

      // Renvoyer `enabled` au passage éteindrait le service de quelqu'un qui
      // voulait seulement toucher aux profils.
      expect(client.post).toHaveBeenCalledWith('/user-manager/set', {
        'use-profiles': 'no',
      });
    });

    it('vise un paquet par son identifiant, forme confirmée sur le routeur', async () => {
      client.get.mockResolvedValueOnce([
        { '.id': '*3', name: 'user-manager', version: '7.24.4' },
        { '.id': '*1', name: 'routeros', version: '7.24.4' },
      ]);
      client.post.mockResolvedValueOnce({});

      await service.unschedulePackage('user-manager');

      expect(client.post).toHaveBeenCalledWith('/system/package/unschedule', { '.id': '*3' });
    });

    it('refuse de programmer un paquet absent plutôt que de deviner', async () => {
      client.get.mockResolvedValueOnce([{ '.id': '*1', name: 'routeros', version: '7.24.4' }]);

      await expect(service.enablePackage('user-manager')).rejects.toThrow(MikrotikNotFoundError);
      expect(client.post).not.toHaveBeenCalled();
    });
  });
});
