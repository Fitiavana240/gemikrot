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
      client.get.mockResolvedValueOnce([{ '.id': '*5', name: 'client05' }]);

      await service.deleteUserManagerUser('client05');

      expect(client.delete).toHaveBeenCalledWith('/user-manager/user/*5');
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
});
