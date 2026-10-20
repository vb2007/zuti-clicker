export interface UnitDefinition {
  id: string;
  baseCost: number;
  baseProduction: number;
  costGrowth: number;
}

export interface UnitState {
  id: string;
  owned: number;
}

// One-time click-power purchases. "flat"/"multiplier"/"synergy" stack
// (sum/multiply/sum across every owned upgrade in the family); "crit" tiers
// do NOT stack — only the highest-cost owned tier applies, like a tier
// upgrade replacing the last. "boosterDuration"/"boosterSpawn" adjust the
// booster system itself rather than the click formula directly.
export type UpgradeFamily =
  | "flat"
  | "multiplier"
  | "synergy"
  | "crit"
  | "boosterDuration"
  | "boosterSpawn";

export interface UpgradeDefinition {
  id: string;
  family: UpgradeFamily;
  cost: number;
  // Meaning depends on family: flat -> tokens added to base click;
  // multiplier -> multiplicative factor (e.g. 2 for x2); synergy -> fraction
  // of tokensPerSecond added per click; boosterDuration/boosterSpawn ->
  // fractional bonus applied to booster duration / spawn frequency. Unused
  // for "crit" (see critChance/critMultiplier below).
  effect: number;
  critChance?: number;
  critMultiplier?: number;
}

// A booster's underlying mechanical target. "instant" (windfall) and "crit"
// (critStorm) are Academic Career unlocks: an instant token grant the server
// credits itself, and a timed crit-chance buff.
export type BoosterKind = "production" | "click" | "costReduction" | "instant" | "crit";

export interface BoosterDefinition {
  id: string;
  kind: BoosterKind;
  // production/click: multiplicative factor (e.g. 7 for x7).
  // costReduction: fraction knocked off unit cost (e.g. 0.25 for -25%).
  multiplier: number;
  durationSecs: number;
  // Relative weight in the server's (or, for guests, the client's) weighted
  // random pick — not a probability on its own.
  weight: number;
  // In the pool only once an Academic Career unlockBooster node is owned.
  career?: boolean;
}

// A live buff. `expiresAt` is an epoch-ms timestamp anchored to the client's
// own clock the moment the buff was granted/loaded — never trusted from a
// server-sent absolute time, so clock skew can't extend it (see
// composables/useBoosters.ts).
export interface ActiveBoosterState {
  id: string;
  expiresAt: number;
}

export type Multiplier = 1 | 5 | 10 | 50 | "max";
export type Theme = "dark" | "light";
export type Language = "en" | "hu";
export type PrestigeCeremony = "full" | "brief";
// Keep in sync with api/src/constants/leaderboard.ts's LEADERBOARD_METRICS keys.
export type LeaderboardMetric = "tokens" | "clicks" | "phd" | "playtime";

export interface AuthUser {
  id: number;
  username: string;
  email: string;
}
