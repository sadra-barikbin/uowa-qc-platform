/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    // Co-located *.test.ts files (e.g. utils/aiJobs.test.ts).
    testMatch: ['**/*.test.ts'],
    // The tests mock '../models' and './aiEvaluator', so nothing touches Postgres or the
    // Anthropic API — they exercise the orchestration only.
    clearMocks: true,
};
