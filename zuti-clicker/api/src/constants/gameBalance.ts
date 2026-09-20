// Server-side mirror of frontend/src/utils/gameConstants.ts. The anti-cheat
// save validator (services/saveValidator.ts) needs to know what a save could
// legitimately contain, which means it needs the same balance curve the
// client uses to compute costs/production/click value. There is no shared
// package between the two deployed apps (see CLAUDE.md's "Repo shape"), so
// this is a deliberate, hand-kept duplicate — every value below carries a
// "keep in sync with" comment pointing at its frontend source, and
// src/tests/economy-parity.test.ts cross-checks both copies against one
// shared golden-vector table rather than trusting the comments alone.
//
// Only what the validator's bounds actually need is mirrored here — e.g.
// nothing about upgrade *names* or i18n, just the numbers that feed cost/
// production/click-value arithmetic.

export interface UnitDefinition {
  id: string;
  baseCost: number;
  baseProduction: number;
  costGrowth: number;
}

// Keep in sync with frontend/src/utils/gameConstants.ts's UNIT_DEFINITIONS.
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

export const KNOWN_UNIT_IDS = UNIT_DEFINITIONS.map((d) => d.id);

export function isKnownUnitId(value: unknown): value is string {
  return typeof value === "string" && KNOWN_UNIT_IDS.includes(value);
}

export function getUnitDefinition(unitId: string): UnitDefinition | undefined {
  return UNIT_DEFINITIONS.find((d) => d.id === unitId);
}

// Keep in sync with frontend/src/utils/gameConstants.ts.
export const BASE_TOKENS_PER_CLICK = 1;

// Prestige ("PhD") balance constants — keep in sync with
// frontend/src/utils/gameConstants.ts.
export const PHD_TOKEN_SCALE = 1_000_000;
export const PHD_PRODUCTION_BONUS = 0.02;
export const PHD_COST_REDUCTION = 0.005;
export const PHD_COST_REDUCTION_CAP = 0.5;

export interface UpgradeDefinition {
  id: string;
  family: "flat" | "multiplier" | "synergy" | "crit" | "boosterDuration" | "boosterSpawn";
  cost: number;
  effect: number;
  critChance?: number;
  critMultiplier?: number;
}

// Keep in sync with frontend/src/utils/gameConstants.ts's UPGRADE_DEFINITIONS.
// Only the fields the envelope's minSpend/maxClick bounds actually consume
// (family, cost, effect, crit*) are mirrored — display copy is not.
export const UPGRADE_DEFINITIONS: UpgradeDefinition[] = [
  { id: "chalk", family: "flat", cost: 150, effect: 1 },
  { id: "redPen", family: "flat", cost: 2_000, effect: 4 },
  { id: "laserPointer", family: "flat", cost: 30_000, effect: 20 },
  { id: "overheadProjector", family: "flat", cost: 600_000, effect: 100 },

  { id: "firmHandshake", family: "multiplier", cost: 500, effect: 2 },
  { id: "morningCoffee", family: "multiplier", cost: 7_500, effect: 2 },
  { id: "officeHours", family: "multiplier", cost: 150_000, effect: 2 },
  { id: "tenure", family: "multiplier", cost: 4_000_000, effect: 2 },
  { id: "honoraryDegree", family: "multiplier", cost: 120_000_000, effect: 2 },

  { id: "lectureNotes", family: "synergy", cost: 250_000, effect: 0.005 },
  { id: "seminarRoom", family: "synergy", cost: 6_000_000, effect: 0.0075 },
  { id: "researchGrant", family: "synergy", cost: 90_000_000, effect: 0.0075 },
  { id: "facultyBoard", family: "synergy", cost: 1_500_000_000, effect: 0.01 },

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

  { id: "conferenceBadge", family: "boosterDuration", cost: 1_200_000, effect: 0.3 },
  { id: "departmentNewsletter", family: "boosterSpawn", cost: 20_000_000, effect: 1 / 3 }
];

export function getUpgradeDefinition(upgradeId: string): UpgradeDefinition | undefined {
  return UPGRADE_DEFINITIONS.find((d) => d.id === upgradeId);
}

// Highest crit multiplier obtainable from any single owned tier — used by the
// envelope's maxClick bound. Keep in sync with the crit tiers above.
export const MAX_CRIT_MULTIPLIER = Math.max(
  1,
  ...UPGRADE_DEFINITIONS.map((d) => d.critMultiplier ?? 0)
);

// Booster multipliers — keep in sync with frontend/src/utils/gameConstants.ts's
// BOOSTER_DEFINITIONS. Only the strongest multiplier of each kind matters for
// the envelope, since it always assumes the most generous case.
export const MAX_PRODUCTION_BOOSTER_MULTIPLIER = 7; // "frenzy"
export const MAX_CLICK_BOOSTER_MULTIPLIER = 10; // "clickStorm"
export const MIN_COST_BOOSTER_MULTIPLIER = 1 - 0.25; // "clearance" (-25%)
