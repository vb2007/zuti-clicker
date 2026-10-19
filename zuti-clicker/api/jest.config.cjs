/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          esModuleInterop: true
        }
      }
    ]
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1"
  },
  testMatch: ["<rootDir>/src/tests/**/*.test.ts"],
  verbose: true,
  // Every suite talks to a live server and a shared remote database, and
  // several spawn their own servers (one tsx compile each) at the same moment.
  // On the self-hosted CI runner that start-up burst can push a plain
  // register/login past Jest's 5 s default — a slow request, not a failure.
  testTimeout: 20_000,
  // Jest otherwise starts one worker per suite up to (cores − 1), each about
  // 600 MB (ts-jest + Prisma client). On the self-hosted runner, which also
  // hosts the database, 22 suites at once ran it out of memory: the kernel
  // SIGKILLed a worker mid-run and swapping stalled every other suite past
  // its timeout. A fixed cap keeps the run's footprint flat as suites grow.
  maxWorkers: 4,
  forceExit: true
};
