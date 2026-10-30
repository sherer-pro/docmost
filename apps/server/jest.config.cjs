const requestedWorkers = process.env.JEST_MAX_WORKERS;
if (requestedWorkers !== undefined && (!/^[1-9]\d?$/.test(requestedWorkers) || Number(requestedWorkers) > 16)) {
  throw new Error('JEST_MAX_WORKERS must be an integer from 1 to 16');
}

/** @type {import('jest').Config} */
module.exports = {
  ...(requestedWorkers === undefined ? {} : {maxWorkers: Number(requestedWorkers)}),
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  coverageProvider: 'v8',
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '^happy-dom$': '<rootDir>/test/mocks/happy-dom.mock.ts',
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@docmost/api-contract$': '<rootDir>/../../packages/api-contract/src/index.ts',
    '^@docmost/api-contract/(.*)$': '<rootDir>/../../packages/api-contract/src/$1',
    '^@docmost/db/(.*)$': '<rootDir>/src/database/$1',
    '^@docmost/transactional/(.*)$':
      '<rootDir>/src/integrations/transactional/$1',
    '^@docmost/editor-ext$': '<rootDir>/test/mocks/editor-ext.mock.ts',
    '^@docmost/editor-ext/(.*)$': '<rootDir>/test/mocks/editor-ext.mock.ts',
    '^p-limit$': '<rootDir>/test/mocks/p-limit.mock.cjs',
  },
  moduleDirectories: ['node_modules', '<rootDir>/src'],
  collectCoverageFrom: ['src/**/*.{ts,js}', '!**/*.spec.ts', '!**/*.d.ts', '!main.ts'],
  coverageDirectory: '<rootDir>/coverage',
  testEnvironment: 'node',
};
