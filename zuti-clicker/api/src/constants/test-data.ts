export class TestData {
  static readonly BASE_URL = "http://localhost:2710";

  // Generated — call once per test suite so each run gets a unique user
  static generateUser() {
    const suffix = Math.random().toString(36).substring(2, 10);
    return {
      username: `test_${suffix}`,
      email: `test_${suffix}@example.com`,
      password: "TestPassword123!"
    };
  }

  // Hardcoded save payloads
  static readonly VALID_SAVE = {
    tokens: 1234.56,
    totalTokensEarned: 9999.99,
    totalClicks: 42,
    elapsedSeconds: 3600.5,
    units: [
      { unitId: "alpha", owned: 5 },
      { unitId: "beta", owned: 2 }
    ]
  };

  static readonly UPDATED_SAVE = {
    tokens: 5678.9,
    totalTokensEarned: 15000.0,
    totalClicks: 100,
    elapsedSeconds: 7200.0,
    units: [
      { unitId: "alpha", owned: 10 },
      { unitId: "gamma", owned: 3 }
    ]
  };

  // Missing the top-level number fields (tokens is absent)
  static readonly SAVE_MISSING_FIELDS = {
    totalTokensEarned: 100,
    totalClicks: 5,
    elapsedSeconds: 60,
    units: []
  };

  // units array contains invalid shape (wrong types)
  static readonly SAVE_INVALID_UNITS = {
    tokens: 100,
    totalTokensEarned: 100,
    totalClicks: 1,
    elapsedSeconds: 10,
    units: [{ unitId: 123, owned: -1 }]
  };

  // units array is shape-valid but has the same unitId twice - would 500 on
  // UnitSave's (gameSaveId, unitId) unique constraint if it reached the DB
  static readonly SAVE_DUPLICATE_UNIT_IDS = {
    tokens: 100,
    totalTokensEarned: 100,
    totalClicks: 1,
    elapsedSeconds: 10,
    units: [
      { unitId: "alpha", owned: 1 },
      { unitId: "alpha", owned: 2 }
    ]
  };

  // Full save shape including the prestige fields
  static readonly PRESTIGE_SAVE = {
    tokens: 500.25,
    totalTokensEarned: 12000000,
    totalClicks: 150,
    elapsedSeconds: 5400,
    phdCount: 3,
    prestigeCount: 2,
    runTokensEarned: 4000000,
    runClicks: 40,
    runSeconds: 1200,
    units: [{ unitId: "alpha", owned: 7 }]
  };

  // Legacy-client shape: the five original fields only, no prestige keys at all
  static readonly LEGACY_SAVE = {
    tokens: 999.5,
    totalTokensEarned: 8000000,
    totalClicks: 80,
    elapsedSeconds: 2400,
    units: [{ unitId: "alpha", owned: 4 }]
  };

  static readonly SAVE_NEGATIVE_PHD = {
    tokens: 1,
    totalTokensEarned: 1,
    totalClicks: 1,
    elapsedSeconds: 1,
    phdCount: -1,
    units: []
  };

  static readonly SAVE_FRACTIONAL_PHD = {
    tokens: 1,
    totalTokensEarned: 1,
    totalClicks: 1,
    elapsedSeconds: 1,
    phdCount: 1.5,
    units: []
  };

  static readonly SAVE_STRING_PHD = {
    tokens: 1,
    totalTokensEarned: 1,
    totalClicks: 1,
    elapsedSeconds: 1,
    phdCount: "3",
    units: []
  };

  static readonly SAVE_NEGATIVE_RUN = {
    tokens: 1,
    totalTokensEarned: 1,
    totalClicks: 1,
    elapsedSeconds: 1,
    runTokensEarned: -5,
    units: []
  };

  static readonly SAVE_NULL_PRESTIGE_COUNT = {
    tokens: 1,
    totalTokensEarned: 1,
    totalClicks: 1,
    elapsedSeconds: 1,
    prestigeCount: null,
    units: []
  };

  // Exceeds MySQL's signed INT range (2147483647) — must be rejected with a
  // 400 rather than reaching Prisma and causing a 500.
  static readonly SAVE_PHD_TOO_LARGE = {
    tokens: 1,
    totalTokensEarned: 1,
    totalClicks: 1,
    elapsedSeconds: 1,
    phdCount: 3000000000,
    units: []
  };

  // Full save shape including two known upgrade ids.
  static readonly SAVE_WITH_UPGRADES = {
    tokens: 100,
    totalTokensEarned: 5000,
    totalClicks: 20,
    elapsedSeconds: 300,
    units: [],
    upgrades: ["chalk", "firmHandshake"]
  };

  static readonly SAVE_UPDATED_UPGRADES = {
    tokens: 50,
    totalTokensEarned: 6000,
    totalClicks: 25,
    elapsedSeconds: 400,
    units: [],
    upgrades: ["chalk"]
  };

  // Legacy-client shape (no `upgrades` key at all) — omitted must preserve
  // whatever is already stored, never wipe it.
  static readonly SAVE_NO_UPGRADES_KEY = {
    tokens: 75,
    totalTokensEarned: 7000,
    totalClicks: 30,
    elapsedSeconds: 500,
    units: []
  };

  static readonly SAVE_INVALID_UPGRADES_UNKNOWN_ID = {
    tokens: 1,
    totalTokensEarned: 1,
    totalClicks: 1,
    elapsedSeconds: 1,
    units: [],
    upgrades: ["not-a-real-upgrade"]
  };

  static readonly SAVE_INVALID_UPGRADES_NOT_ARRAY = {
    tokens: 1,
    totalTokensEarned: 1,
    totalClicks: 1,
    elapsedSeconds: 1,
    units: [],
    upgrades: "chalk"
  };

  // Would otherwise reach UpgradeSave's unique constraint and 500 — must be
  // rejected with 400 at validation instead.
  static readonly SAVE_INVALID_UPGRADES_DUPLICATE = {
    tokens: 1,
    totalTokensEarned: 1,
    totalClicks: 1,
    elapsedSeconds: 1,
    units: [],
    upgrades: ["chalk", "chalk"]
  };

  static readonly VALID_SETTINGS = {
    theme: "light",
    language: "hu",
    autosaveEnabled: false,
    autosaveIntervalSecs: 300,
    prestigeCeremony: "brief",
    hideFromLeaderboards: true
  };

  static readonly DEFAULT_SETTINGS_EXPECTED = {
    theme: "dark",
    language: "en",
    autosaveEnabled: true,
    autosaveIntervalSecs: 30,
    prestigeCeremony: "full",
    hideFromLeaderboards: false
  };

  static readonly SETTINGS_PARTIAL = { theme: "dark" };
  static readonly SETTINGS_INVALID_THEME = { theme: "neon" };
  static readonly SETTINGS_INVALID_LANGUAGE = { language: "de" };
  static readonly SETTINGS_INVALID_CEREMONY = { prestigeCeremony: "medium" };
  static readonly SETTINGS_INVALID_INTERVAL = { autosaveIntervalSecs: 45 };
  static readonly SETTINGS_STRING_INTERVAL = { autosaveIntervalSecs: "30" };
  static readonly SETTINGS_INVALID_ENABLED = { autosaveEnabled: "yes" };
  static readonly SETTINGS_INVALID_HIDE_FROM_LEADERBOARDS = { hideFromLeaderboards: "yes" };
  static readonly SETTINGS_UNKNOWN_KEY = { someFutureSetting: true };
  static readonly SETTINGS_MIXED_INVALID = { theme: "light", language: "de" };

  // Base shape for leaderboard tests — override totalTokensEarned/
  // totalClicks/phdCount/elapsedSeconds per user to control ranking.
  static readonly LEADERBOARD_BASE_SAVE = {
    tokens: 0,
    totalTokensEarned: 0,
    totalClicks: 0,
    elapsedSeconds: 0,
    phdCount: 0,
    units: []
  };
}
