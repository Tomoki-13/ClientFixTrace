/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    "<rootDir>/src/__tests__/**/*.ts",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/clientRepos/"
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "<rootDir>/output/",
    "<rootDir>/clientRepos"
  ],
};