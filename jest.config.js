/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server/index.ts',
    '!src/cli/index.ts',
    '!src/lib/**',
    '!src/config/**',
  ],
  coverageDirectory: 'coverage',
  testTimeout: 10000,
};
