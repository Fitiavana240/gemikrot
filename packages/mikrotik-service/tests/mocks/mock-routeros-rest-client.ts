/**
 * Mock du `RouterOSRestClient`, utilisé pour tester `RouterOSMikrotikService`
 * SANS faire le moindre appel HTTP réel. On ne mocke que la frontière
 * (get/put/post/patch/delete) : toute la logique de mapping, validation et
 * gestion d'erreurs du service reste réellement exécutée par les tests.
 *
 * `put` crée une entrée, `post` appelle une commande : c'est la convention
 * REST de RouterOS v7, un POST sur une collection renvoie "no such command".
 */
export function createMockRestClient() {
  return {
    get: jest.fn(),
    put: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
}

export type MockRestClient = ReturnType<typeof createMockRestClient>;
