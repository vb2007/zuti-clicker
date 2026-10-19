import {
  UNIT_DEFINITIONS,
  BOOSTER_DEFINITIONS,
  PHD_PRODUCTION_BONUS,
  PHD_COST_REDUCTION,
  PHD_COST_REDUCTION_CAP
} from "@/utils/gameConstants";
import { CAREER_CAPS, type CareerModifiers } from "@/utils/careerCore";

/**
 * How the Academic Career tree's modifiers (utils/careerCore.ts's
 * getCareerModifiers) feed the economy. Pure functions of already-folded
 * modifiers, the same shape as prestige.ts/upgrades.ts, so gameStore's
 * computeds stay thin wrappers. Mirrors api/src/services/economy.ts's career
 * section function for function — both are checked against the shared
 * fixtures/career-vectors.json by career-parity.spec.ts / .test.ts, so keep
 * every formula here in sync with it.
 */

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
  const def = BOOSTER_DEFINITIONS.find((d) => d.id === boosterId);
  if (!def) return 1;
  const potency = 1 + (mods.boosterPotency[boosterId] ?? 0);
  if (def.kind === "production" || def.kind === "click") {
    return 1 + (def.multiplier - 1) * potency;
  }
  if (def.kind === "costReduction") {
    return 1 - Math.min(CAREER_CAPS.clearanceDiscount, def.multiplier * potency);
  }
  return 1;
}

/** The base three are always in the pool; career boosters once unlocked. */
export function isBoosterInPool(boosterId: string, mods: CareerModifiers): boolean {
  const def = BOOSTER_DEFINITIONS.find((d) => d.id === boosterId);
  if (!def) return false;
  return !def.career || mods.unlockedBoosters.includes(boosterId);
}

/**
 * The strongest multiplier of a kind the player's booster pool could produce
 * at once — the product over every booster of that kind, since
 * getActiveBoosterMultiplier stacks same-kind boosters multiplicatively.
 */
export function getMaxBoosterMultiplier(
  kind: "production" | "click" | "costReduction",
  mods: CareerModifiers
): number {
  return BOOSTER_DEFINITIONS.filter((d) => d.kind === kind && isBoosterInPool(d.id, mods)).reduce(
    (mult, d) => mult * getBoosterEffectMultiplier(d.id, mods),
    1
  );
}

/**
 * The windfall booster's instant grant: windfallSecs of the player's
 * UNBOOSTED production (PhDs + tree, no active buff). A logged-in player's
 * grant is computed and credited by the server; this is the guest mirror.
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

/** The booster spawn divisor: departmentNewsletter + tree spawn bonus, capped. */
export function getBoosterSpawnDivisor(
  upgradeSpawnMultiplier: number,
  mods: CareerModifiers
): number {
  return Math.min(CAREER_CAPS.boosterSpawnDivisor, upgradeSpawnMultiplier + mods.boosterSpawnPct);
}
