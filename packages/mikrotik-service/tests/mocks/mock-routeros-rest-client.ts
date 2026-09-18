/**
 * Mock du `RouterOSRestClient`, utilisé pour tester `RouterOSMikrotikService`
 * SANS faire le moindre appel HTTP réel. On ne mocke que la frontière
 * (get/post/patch/delete) : toute la logique de mapping, validation et
 * gestion d'erreurs du service reste réellement exécutée par les tests.
 */
export function createMockRestClient() {
  return {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
}

export type MockRestClient = ReturnType<typeof createMockRestClient>;
