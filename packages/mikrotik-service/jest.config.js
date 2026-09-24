/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // `tsconfig.test.json` et non celui de la construction : c'est lui qui
  // declare les types de Jest et qui inclut `tests/`. Avec l'autre, ts-jest
  // compilait chaque epreuve sans connaitre `describe` ni `expect`, et les
  // dix suites tombaient avant d'avoir execute un seul test -- << 10 failed,
  // 0 total >>, ce qui se lit comme une suite en panne et non comme une
  // suite absente.
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.spec.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  clearMocks: true,
};
