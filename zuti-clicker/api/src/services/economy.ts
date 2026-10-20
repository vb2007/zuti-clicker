// Server-side mirror of the pure formulas in frontend/src/utils/
// {costCalculator,prestige,upgrades}.ts. Ported (not imported — there is no
// shared package between the two apps, see CLAUDE.md's "Repo shape") because
// services/saveValidator.ts needs to compute the same numbers the client did
// in order to bound what an incoming save could legitimately contain.
//
// Every float-correction step is copied verbatim from its frontend
// counterpart: these matter exactly at the boundaries the validator probes.
// src/tests/economy-parity.test.ts cross-checks both copies against one
// shared golden-vector table.
import {
  UNIT_DEFINITIONS,
  UPGRADE_DEFINITIONS,
  BASE_TOKENS_PER_CLICK,
  PHD_TOKEN_SCALE,
  PHD_PRODUCTION_BONUS,
  PHD_COST_REDUCTION,
  PHD_COST_REDUCTION_CAP,
  BOOSTER_EFFECTS,
  type UnitDefinition
} from "../constants/gameBalance";
import { CAREER_CAPS, type CareerModifiers } from "./careerCore";

// ---- costCalculator.ts mirror -------------------------------------------

export function getUnitCost(unit: UnitDefinition, owned: number, costMultiplier = 1): number {
  return unit.baseCost * costMultiplier * Math.pow(unit.costGrowth, owned);
}

export function getBulkCost(
  unit: UnitDefinition,
  owned: number,
  amount: number,
  costMultiplier = 1
): number {
  if (amount <= 0) return 0;
  const { baseCost, costGrowth } = unit;
  return (
    (baseCost * costMultiplier * Math.pow(costGrowth, owned) * (Math.pow(costGrowth, amount) - 1)) /
    (costGrowth - 1)
  );
}

// ---- prestige.ts mirror ---------------------------------------------------

/** PhDs awarded for a run worth `runTokensEarned` tokens: floor(sqrt(t / SCALE)). */
export function getPhdGain(runTokensEarned: number): number {
  if (!isFinite(runTokensEarned) || runTokensEarned < PHD_TOKEN_SCALE) return 0;
  let g = Math.floor(Math.sqrt(runTokensEarned / PHD_TOKEN_SCALE));
  if (g > 0 && g * g * PHD_TOKEN_SCALE > runTokensEarned) g--;
  else if ((g + 1) * (g + 1) * PHD_TOKEN_SCALE <= runTokensEarned) g++;
  return Math.max(0, g);
}

export function getProductionMultiplier(phd: number): number {
  if (!isFinite(phd) || phd <= 0) return 1;
  return 1 + PHD_PRODUCTION_BONUS * phd;
}

export function getCostMultiplier(phd: number): number {
  if (!isFinite(phd) || phd <= 0) return 1;
  return 1 - Math.min(PHD_COST_REDUCTION_CAP, PHD_COST_REDUCTION * phd);
}

// ---- upgrades.ts mirror (click-power formulas only) ------------------------

function ownedDefs(ownedUpgrades: readonly string[]) {
  const owned = new Set(ownedUpgrades);
  return UPGRADE_DEFINITIONS.filter((d) => owned.has(d.id));
}

export function getFlatClickBonus(ownedUpgrades: readonly string[]): number {
  return ownedDefs(ownedUpgrades)
    .filter((d) => d.family === "flat")
    .reduce((sum, d) => sum + d.effect, 0);
}

export function getClickMultiplier(ownedUpgrades: readonly string[]): number {
  return ownedDefs(ownedUpgrades)
    .filter((d) => d.family === "multiplier")
    .reduce((mult, d) => mult * d.effect, 1);
}

export function getClickSynergy(ownedUpgrades: readonly string[]): number {
  return ownedDefs(ownedUpgrades)
    .filter((d) => d.family === "synergy")
    .reduce((sum, d) => sum + d.effect, 0);
}

export interface ClickValueParams {
  flatClickBonus: number;
  clickMultiplier: number;
  phdProductionMultiplier: number;
  tokensPerSecond: number;
  clickSynergy: number;
  boosterClickMultiplier: number;
}

/** Non-crit click value — see frontend/src/utils/upgrades.ts's getClickValue. */
export function getClickValue(params: ClickValueParams): number {
  const {
    flatClickBonus,
    clickMultiplier,
    phdProductionMultiplier,
    tokensPerSecond,
    clickSynergy,
    boosterClickMultiplier
  } = params;
  const basePart =
    (BASE_TOKENS_PER_CLICK + flatClickBonus) * clickMultiplier * phdProductionMultiplier;
  return (basePart + tokensPerSecond * clickSynergy) * boosterClickMultiplier;
}

export { UNIT_DEFINITIONS, UPGRADE_DEFINITIONS };

// ---- Academic Career (services/careerCore.ts) mirror -----------------------
// Mirrors frontend/src/utils/careerEconomy.ts — both checked against the
// shared fixtures/career-vectors.json by career-parity.test.ts / .spec.ts.
// Every function takes the already-aggregated CareerModifiers (from
// getCareerModifiers) rather than node ids, so a caller folds the tree once.

/** The held-PhD production multiplier with the tree's per-PhD bonus added. */
export function getCareerPhdProductionMultiplier(phd: number, mods: CareerModifiers): number {
  if (!isFinite(phd) || phd <= 0) return 1;
  return 1 + (PHD_PRODUCTION_BONUS + mods.phdProductionBonusAdd) * phd;
}

/** The held-PhD unit cost multiplier with the tree's raised discount cap. */
export function getCareerPhdCostMultiplier(phd: number, mods: CareerModifiers): number {
  if (!isFinite(phd) || phd <= 0) return 1;
  return 1 - Math.min(PHD_COST_REDUCTION_CAP + mods.phdCostCapAdd, PHD_COST_REDUCTION * phd);
}

/** The tree's own production multiplier (on top of PhDs and boosters). */
export function getCareerProductionMultiplier(mods: CareerModifiers): number {
  return (1 + mods.productionPct) * mods.productionMult;
}

/** Unboosted base tokens/sec of a unit set, with the tree's per-unit multipliers. */
export function getCareerBaseTps(
  units: readonly { unitId: string; owned: number }[],
  mods: CareerModifiers
): number {
  return units.reduce((sum, u) => {
    const def = UNIT_DEFINITIONS.find((d) => d.id === u.unitId);
    if (!def) return sum;
    return sum + u.owned * def.baseProduction * (mods.unitProductionMult[u.unitId] ?? 1);
  }, 0);
}

/**
 * What a unit purchase actually pays per base cost: the PhD discount, the
 * tree's unit discount and a booster discount stacked, never below
 * CAREER_CAPS.costMultiplierFloor.
 */
export function getCareerUnitCostMultiplier(
  phd: number,
  mods: CareerModifiers,
  boosterCostMultiplier = 1
): number {
  return Math.max(
    CAREER_CAPS.costMultiplierFloor,
    getCareerPhdCostMultiplier(phd, mods) * (1 - mods.unitCostDiscount) * boosterCostMultiplier
  );
}

/** An upgrade's price with the tree's upgrade discount. */
export function getCareerUpgradeCost(baseCost: number, mods: CareerModifiers): number {
  return baseCost * (1 - mods.upgradeCostDiscount);
}

/** Upgrade synergy plus the tree's, capped. */
export function getCareerClickSynergy(upgradeSynergy: number, mods: CareerModifiers): number {
  return Math.min(CAREER_CAPS.totalClickSynergy, upgradeSynergy + mods.clickSynergyAdd);
}

/**
 * One booster's effective multiplier with its potency nodes: a production/
 * click booster's bonus part grows (x7 at +50% -> x10), a cost booster's
 * discount grows up to CAREER_CAPS.clearanceDiscount. Returns the multiplier
 * a purchase/income is scaled by (so a cost booster returns 1 - discount).
 */
export function getBoosterEffectMultiplier(boosterId: string, mods: CareerModifiers): number {
  const effect = BOOSTER_EFFECTS[boosterId];
  if (!effect) return 1;
  const potency = 1 + (mods.boosterPotency[boosterId] ?? 0);
  if (effect.kind === "production" || effect.kind === "click") {
    return 1 + (effect.multiplier - 1) * potency;
  }
  if (effect.kind === "costReduction") {
    return 1 - Math.min(CAREER_CAPS.clearanceDiscount, effect.multiplier * potency);
  }
  return 1;
}

/**
 * The strongest multiplier of a kind a player's booster pool could produce at
 * once: the product over every booster of that kind (the client stacks
 * same-kind boosters multiplicatively — see getActiveBoosterMultiplier).
 */
export function getMaxBoosterMultiplier(
  kind: "production" | "click" | "costReduction",
  mods: CareerModifiers
): number {
  return Object.entries(BOOSTER_EFFECTS)
    .filter(([id, e]) => e.kind === kind && isBoosterInPool(id, mods))
    .reduce((mult, [id]) => mult * getBoosterEffectMultiplier(id, mods), 1);
}

/** The base three are always in the pool; career boosters once unlocked. */
export function isBoosterInPool(boosterId: string, mods: CareerModifiers): boolean {
  if (boosterId === "frenzy" || boosterId === "clickStorm" || boosterId === "clearance")
    return true;
  return mods.unlockedBoosters.includes(boosterId);
}

/**
 * The windfall booster's instant grant: windfallSecs of the player's
 * UNBOOSTED production (PhDs + tree, no active buff) at the moment of claim.
 */
export function getWindfallGrant(
  units: readonly { unitId: string; owned: number }[],
  phd: number,
  mods: CareerModifiers
): number {
  return (
    mods.windfallSecs *
    getCareerBaseTps(units, mods) *
    getCareerPhdProductionMultiplier(phd, mods) *
    getCareerProductionMultiplier(mods)
  );
}
