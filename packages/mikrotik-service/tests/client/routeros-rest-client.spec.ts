import { RouterOSRestClient } from '../../src/client/routeros-rest-client';
import {
  MikrotikApiError,
  MikrotikAuthError,
  MikrotikConnectionError,
  MikrotikTimeoutError,
} from '../../src/errors/mikrotik.errors';
import { createSilentLogger } from '../mocks/silent-logger';

// `undici.fetch` est exporté en lecture seule : jest.spyOn ne peut pas le
// redéfinir, d'où un jest.mock explicite au niveau du module.
const fetchMock = jest.fn();
jest.mock('undici', () => ({
  ...jest.requireActual('undici'),
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('RouterOSRestClient', () => {
  const baseConfig = {
    baseUrl: 'https://192.168.88.1',
    username: 'wifitati-svc',
    password: 'test-password',
    timeoutMs: 200,
    maxRetries: 2,
    retryDelayMs: 10,
  };

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('retourne les données JSON en cas de succès', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { name: 'wifitati-hap' }));

    const client = new RouterOSRestClient(baseConfig, createSilentLogger());
    const result = await client.get<{ name: string }>('/system/identity');

    expect(result).toEqual({ name: 'wifitati-hap' });
  });

  it('mappe un 401 en MikrotikAuthError et NE retente PAS', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));

    const client = new RouterOSRestClient(baseConfig, createSilentLogger());

    await expect(client.get('/system/identity')).rejects.toBeInstanceOf(MikrotikAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // pas de retry sur une erreur non-retryable
  });

  it('mappe un 500 en MikrotikApiError et NE retente PAS (erreur métier RouterOS)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { message: 'internal error' }));

    const client = new RouterOSRestClient(baseConfig, createSilentLogger());

    await expect(client.get('/system/resource')).rejects.toBeInstanceOf(MikrotikApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retente en cas de timeout puis réussit à la 2e tentative', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });

    fetchMock
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(jsonResponse(200, { name: 'ok-after-retry' }));

    const client = new RouterOSRestClient(baseConfig, createSilentLogger());
    const result = await client.get<{ name: string }>('/system/identity');

    expect(result).toEqual({ name: 'ok-after-retry' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('épuise les tentatives et lève MikrotikTimeoutError si toutes échouent', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValue(abortError);

    const client = new RouterOSRestClient(baseConfig, createSilentLogger());

    await expect(client.get('/system/identity')).rejects.toBeInstanceOf(MikrotikTimeoutError);
    // 1 tentative initiale + maxRetries (2) = 3 appels au total
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('mappe une erreur réseau générique en MikrotikConnectionError', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const client = new RouterOSRestClient(baseConfig, createSilentLogger());

    await expect(client.get('/system/identity')).rejects.toBeInstanceOf(MikrotikConnectionError);
  });
});
