/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  coverageProvider: 'v8',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@docmost/api-contract$': '<rootDir>/../../packages/api-contract/src/index.ts',
    '^@docmost/api-contract/(.*)$': '<rootDir>/../../packages/api-contract/src/$1',
    '^@docmost/db/(.*)$': '<rootDir>/src/database/$1',
    '^@docmost/transactional/(.*)$':
      '<rootDir>/src/integrations/transactional/$1',
    '^@docmost/ee/(.*)$': '<rootDir>/src/ee/$1',
  },
  moduleDirectories: ['node_modules', '<rootDir>/src'],
  collectCoverageFrom: ['src/**/*.{ts,js}', '!**/*.spec.ts', '!**/*.d.ts', '!main.ts'],
  coverageDirectory: '<rootDir>/coverage',
  testEnvironment: 'node',
};
