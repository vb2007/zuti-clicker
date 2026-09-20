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
  type UnitDefinition
} from "../constants/gameBalance";

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
  const basePart = (BASE_TOKENS_PER_CLICK + flatClickBonus) * clickMultiplier * phdProductionMultiplier;
  return (basePart + tokensPerSecond * clickSynergy) * boosterClickMultiplier;
}

export { UNIT_DEFINITIONS, UPGRADE_DEFINITIONS };
