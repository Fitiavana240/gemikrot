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
      expect(client.post).not.toHaveBeenCalled();
    });

    it("lève un conflit si l'utilisateur existe déjà", async () => {
      client.get.mockResolvedValueOnce([{ '.id': '*1', name: 'client01' }]);

      await expect(
        service.createUserManagerUser({ username: 'client01', password: 'secret123' }),
      ).rejects.toBeInstanceOf(MikrotikConflictError);

      expect(client.post).not.toHaveBeenCalled();
    });

    it('crée l\'utilisateur et retourne le DTO mappé quand tout est valide', async () => {
      client.get.mockResolvedValueOnce([]); // aucun utilisateur existant
      client.post.mockResolvedValueOnce({
        '.id': '*2',
        name: 'client02',
        'shared-users': '1',
      });

      const result = await service.createUserManagerUser({
        username: 'client02',
        password: 'secret123',
      });

      expect(result.username).toBe('client02');
      expect(client.post).toHaveBeenCalledWith(
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
    it('crée le profile puis le profile-limitation avec le bon rate-limit', async () => {
      client.post.mockResolvedValueOnce({}); // /user-manager/profile
      client.post.mockResolvedValueOnce({
        '.id': '*9',
        name: 'forfait-7j',
        validity: '604800s',
        'starts-when': 'logon',
        'rate-limit': '2M/1M',
      });

      const result = await service.createProfile({
        name: 'forfait-7j',
        validityDurationSeconds: 604800,
        startsWhen: 'logon',
        rateLimitRxBitsPerSecond: 2_000_000,
        rateLimitTxBitsPerSecond: 1_000_000,
      });

      expect(result.name).toBe('forfait-7j');
      expect(result.rateLimit.rxBitsPerSecond).toBe(2_000_000);
      expect(client.post).toHaveBeenNthCalledWith(2, '/user-manager/profile-limitation', expect.objectContaining({
        'rate-limit': '2M/1M',
        'starts-when': 'logon',
      }));
    });
  });
});
