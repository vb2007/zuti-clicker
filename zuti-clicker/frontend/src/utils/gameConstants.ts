import type { UnitDefinition, UpgradeDefinition, BoosterDefinition } from "@/types";

export const UNIT_DEFINITIONS: UnitDefinition[] = [
  { id: "alpha", baseCost: 10, baseProduction: 0.3, costGrowth: 1.15 },
  { id: "beta", baseCost: 100, baseProduction: 1.5, costGrowth: 1.15 },
  { id: "gamma", baseCost: 1_100, baseProduction: 12, costGrowth: 1.15 },
  { id: "delta", baseCost: 12_000, baseProduction: 60, costGrowth: 1.15 },
  { id: "epsilon", baseCost: 130_000, baseProduction: 300, costGrowth: 1.15 },
  { id: "zeta", baseCost: 1_400_000, baseProduction: 1_200, costGrowth: 1.15 },
  { id: "eta", baseCost: 20_000_000, baseProduction: 6_000, costGrowth: 1.15 },
  { id: "theta", baseCost: 330_000_000, baseProduction: 30_000, costGrowth: 1.15 }
];

export const TICK_RATE = 20;
export const BASE_TOKENS_PER_CLICK = 1;

// Fraction of a unit's base cost the player must have earned (lifetime) before
// it's revealed in the shop. Extracted from the inline 0.1 previously in UnitCard.vue.
export const UNIT_REVEAL_FRACTION = 0.1;

// Prestige ("PhD") balance constants.
export const PHD_TOKEN_SCALE = 1_000_000;
export const PHD_PRODUCTION_BONUS = 0.02;
export const PHD_COST_REDUCTION = 0.005;
export const PHD_COST_REDUCTION_CAP = 0.5;

export const AUTOSAVE_INTERVAL_OPTIONS = [15, 30, 60, 300] as const;
export const DEFAULT_AUTOSAVE_INTERVAL_SECS = 30;

// One-time click-power purchases, lost on prestige (see gameStore.prestige()).
// Reveal gate mirrors UNIT_REVEAL_FRACTION's one-way discovery rule, keyed to
// each upgrade's own cost rather than a unit's baseCost.
// Keep the id set in sync with api/src/constants/upgrades.ts's
// KNOWN_UPGRADE_IDS allowlist.
export const UPGRADE_REVEAL_FRACTION = 0.25;

export const UPGRADE_DEFINITIONS: UpgradeDefinition[] = [
  // Flat click bonus — stacks additively.
  { id: "chalk", family: "flat", cost: 150, effect: 1 },
  { id: "redPen", family: "flat", cost: 2_000, effect: 4 },
  { id: "laserPointer", family: "flat", cost: 30_000, effect: 20 },
  { id: "overheadProjector", family: "flat", cost: 600_000, effect: 100 },

  // Click multiplier — stacks multiplicatively (x2 each, x32 total owned).
  { id: "firmHandshake", family: "multiplier", cost: 500, effect: 2 },
  { id: "morningCoffee", family: "multiplier", cost: 7_500, effect: 2 },
  { id: "officeHours", family: "multiplier", cost: 150_000, effect: 2 },
  { id: "tenure", family: "multiplier", cost: 4_000_000, effect: 2 },
  { id: "honoraryDegree", family: "multiplier", cost: 120_000_000, effect: 2 },

  // Synergy — click gains +effect of tokens/sec, stacks additively. The four
  // tiers sum to 0.03 (3%): the deliberate cap explained in gameConstants'
  // sibling doc (frontend/src/utils/upgrades.ts) and the plan this
  // implements — crit's expected ~1.9x multiplier brings the effective
  // ceiling to roughly the intended +25% over idle at ~5 clicks/sec.
  { id: "lectureNotes", family: "synergy", cost: 250_000, effect: 0.005 },
  { id: "seminarRoom", family: "synergy", cost: 6_000_000, effect: 0.0075 },
  { id: "researchGrant", family: "synergy", cost: 90_000_000, effect: 0.0075 },
  { id: "facultyBoard", family: "synergy", cost: 1_500_000_000, effect: 0.01 },

  // Crit — tiered, does NOT stack: only the highest-cost owned tier applies.
  { id: "luckyGuess", family: "crit", cost: 80_000, effect: 0, critChance: 0.05, critMultiplier: 3 },
  {
    id: "openBookExam",
    family: "crit",
    cost: 2_500_000,
    effect: 0,
    critChance: 0.1,
    critMultiplier: 5
  },
  {
    id: "peerReview",
    family: "crit",
    cost: 300_000_000,
    effect: 0,
    critChance: 0.15,
    critMultiplier: 7
  },

  // Booster-system perks — single-purchase, additive with each other.
  { id: "conferenceBadge", family: "boosterDuration", cost: 1_200_000, effect: 0.3 },
  { id: "departmentNewsletter", family: "boosterSpawn", cost: 20_000_000, effect: 1 / 3 }
];

// Random booster events (see composables/useBoosters.ts). A pickup spawns
// after a uniform random wait, stays on screen (and can be missed) for a
// short window, and — once claimed — applies its effect for its duration.
// Keep the id/effect set in sync with api/src/constants/boosters.ts.
export const BOOSTER_DEFINITIONS: BoosterDefinition[] = [
  { id: "frenzy", kind: "production", multiplier: 7, durationSecs: 60, weight: 4 },
  { id: "clickStorm", kind: "click", multiplier: 10, durationSecs: 90, weight: 4 },
  { id: "clearance", kind: "costReduction", multiplier: 0.25, durationSecs: 120, weight: 3 }
];

export const BOOSTER_SPAWN_MIN_SECS = 60;
export const BOOSTER_SPAWN_MAX_SECS = 300;
export const BOOSTER_VISIBLE_MIN_SECS = 10;
export const BOOSTER_VISIBLE_MAX_SECS = 20;

// Upgrader (the PhD wheel — see utils/upgrader.ts and components/upgrader/).
// Keep in sync with api/src/constants/upgrader.ts.
// Long-run return on a stake: the wheel is a risk tool, never a PhD farm.
export const UPGRADER_RTP = 0.9;
// A spin's win chance can never exceed this, however small the multiplier.
export const UPGRADER_WIN_CHANCE_CAP = 0.8;
// Multiplier range in whole hundredths so the maths stays in integers
// (120 = x1.2, 10000 = x100).
export const UPGRADER_MIN_MULTIPLIER_HUNDREDTHS = 120;
export const UPGRADER_MAX_MULTIPLIER_HUNDREDTHS = 10_000;
// Win chance resolution: a roll in [0, PPM) wins when roll < winPpm.
export const UPGRADER_PPM = 1_000_000;
// A lost spin grants the existing "frenzy" booster, scaled by the share of the
// player's PhDs that was put up; a loss can extend a running frenzy only up to
// the cap on remaining time.
export const UPGRADER_CONSOLATION_BOOSTER_ID = "frenzy";
export const UPGRADER_CONSOLATION_BASE_MS = 60_000;
export const UPGRADER_CONSOLATION_MIN_MS = 10_000;
export const UPGRADER_CONSOLATION_MAX_REMAINING_MS = 120_000;
// UI only (no server counterpart): the quick-pick multipliers next to the slider.
export const UPGRADER_PRESET_MULTIPLIERS = [1.5, 2, 3, 5, 10] as const;

// Rolling window (see ClickerArea.vue) the clicks-per-second readout
// averages over — long enough to not jitter on every click, short enough to
// feel immediate.
export const CPS_WINDOW_MS = 2000;
