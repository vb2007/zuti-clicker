import { UPGRADE_DEFINITIONS, BOOSTER_DEFINITIONS, BASE_TOKENS_PER_CLICK } from "@/utils/gameConstants";
import { formatNumber, formatPercent } from "@/utils/formatters";
import type { ActiveBoosterState, BoosterKind, UpgradeDefinition } from "@/types";

/**
 * Click-power upgrade formulas. Mirrors the shape of prestige.ts: pure
 * functions of "what's owned" -> a multiplier/bonus, no store dependency, so
 * gameStore's computeds stay thin wrappers around these.
 *
 * Target power level (see the plan this implements): a fully upgraded
 * clicker sustaining ~5 clicks/sec adds roughly +25% over pure idle income.
 * Synergy alone is deliberately capped at 3% (UPGRADE_DEFINITIONS' four
 * synergy tiers sum to 0.03) — crit's expected ~1.9x multiplier
 * (15% chance x7 = 0.15 * 7 + 0.85 * 1 = 1.9) brings the effective per-click
 * ceiling to ~5.7%, i.e. ~+28% at 5 clicks/sec, close to the target. Final
 * tuning happens against the balance-sanity script (see CLAUDE.md's
 * empirical-verification rule) rather than by trusting this comment alone.
 */

function ownedDefs(ownedUpgrades: string[]): UpgradeDefinition[] {
  const owned = new Set(ownedUpgrades);
  return UPGRADE_DEFINITIONS.filter((d) => owned.has(d.id));
}

/** Sum of all owned flat-family bonuses, added to BASE_TOKENS_PER_CLICK. */
export function getFlatClickBonus(ownedUpgrades: string[]): number {
  return ownedDefs(ownedUpgrades)
    .filter((d) => d.family === "flat")
    .reduce((sum, d) => sum + d.effect, 0);
}

/** Product of all owned multiplier-family factors (1 if none owned). */
export function getClickMultiplier(ownedUpgrades: string[]): number {
  return ownedDefs(ownedUpgrades)
    .filter((d) => d.family === "multiplier")
    .reduce((mult, d) => mult * d.effect, 1);
}

/** Sum of all owned synergy-family fractions (fraction of tokens/sec added per click). */
export function getClickSynergy(ownedUpgrades: string[]): number {
  return ownedDefs(ownedUpgrades)
    .filter((d) => d.family === "synergy")
    .reduce((sum, d) => sum + d.effect, 0);
}

/**
 * Highest-cost owned crit tier, since tiers replace rather than stack.
 * Exported (not just used internally) so the owned-upgrades UI can mark
 * every *other* owned crit tier as superseded — bought, but not the one
 * currently in effect.
 */
export function bestCritTier(ownedUpgrades: string[]): UpgradeDefinition | undefined {
  const tiers = ownedDefs(ownedUpgrades).filter((d) => d.family === "crit");
  if (tiers.length === 0) return undefined;
  return tiers.reduce((best, d) => (d.cost > best.cost ? d : best));
}

export function getCritChance(ownedUpgrades: string[]): number {
  return bestCritTier(ownedUpgrades)?.critChance ?? 0;
}

export function getCritMultiplier(ownedUpgrades: string[]): number {
  return bestCritTier(ownedUpgrades)?.critMultiplier ?? 1;
}

/** 1 + sum of owned boosterDuration bonuses (applied to a claimed booster's base duration). */
export function getBoosterDurationMultiplier(ownedUpgrades: string[]): number {
  return (
    1 +
    ownedDefs(ownedUpgrades)
      .filter((d) => d.family === "boosterDuration")
      .reduce((sum, d) => sum + d.effect, 0)
  );
}

/** 1 + sum of owned boosterSpawn bonuses (divides the average wait between spawns). */
export function getBoosterSpawnMultiplier(ownedUpgrades: string[]): number {
  return (
    1 +
    ownedDefs(ownedUpgrades)
      .filter((d) => d.family === "boosterSpawn")
      .reduce((sum, d) => sum + d.effect, 0)
  );
}

/**
 * Combined multiplier from every currently-active (non-expired) booster of a
 * given kind. `now` is passed in (rather than read via Date.now() here) so
 * callers stay pure and easily testable with a fixed clock.
 */
export function getActiveBoosterMultiplier(
  activeBoosters: ActiveBoosterState[],
  now: number,
  kind: BoosterKind
): number {
  return activeBoosters
    .filter((b) => b.expiresAt > now)
    .map((b) => BOOSTER_DEFINITIONS.find((d) => d.id === b.id))
    .filter((d): d is (typeof BOOSTER_DEFINITIONS)[number] => d !== undefined && d.kind === kind)
    .reduce((mult, d) => mult * (kind === "costReduction" ? 1 - d.multiplier : d.multiplier), 1);
}

export interface ClickValueParams {
  flatClickBonus: number;
  clickMultiplier: number;
  phdProductionMultiplier: number;
  tokensPerSecond: number;
  clickSynergy: number;
  boosterClickMultiplier: number;
}

/**
 * Non-crit click value: (base + flat) x multiplier x PhD bonus, plus a slice
 * of the whole economy's tokens/sec (which already carries the PhD and
 * booster production multipliers), all scaled by any active click booster.
 */
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

/** Whether this click rolls a critical hit. Injectable RNG for tests. */
export function rollCrit(critChance: number, rng: () => number = Math.random): boolean {
  if (critChance <= 0) return false;
  return rng() < critChance;
}

/**
 * Weighted-random booster pick — used for a guest's fully-local booster
 * rolls (see composables/useBoosters.ts). A logged-in player's roll happens
 * server-side (POST /boosters/claim) for the anti-cheat reasons in the plan
 * this implements; this is the client-side mirror of that same weighting so
 * guest play feels identical without a server round-trip. Keep this
 * algorithm in sync with api/src/database/models/boosters.ts's own
 * pickWeightedBoosterId.
 */
export function pickWeightedBoosterId(rng: () => number = Math.random): string {
  const totalWeight = BOOSTER_DEFINITIONS.reduce((sum, d) => sum + d.weight, 0);
  let roll = rng() * totalWeight;
  for (const def of BOOSTER_DEFINITIONS) {
    roll -= def.weight;
    if (roll < 0) return def.id;
  }
  // Floating-point fallback — should be unreachable since the loop above
  // covers the full [0, totalWeight) range.
  return BOOSTER_DEFINITIONS[BOOSTER_DEFINITIONS.length - 1]!.id;
}

/**
 * Compact effect label for one upgrade, shared between the buy grid
 * (UpgradeTile.vue) and the owned-upgrades summary (UpgradesPanel.vue) so
 * the two surfaces can never show a different number for the same upgrade.
 * formatPercent (not Math.round): synergy/booster perks step by fractions
 * of a percent, so whole-percent rounding would misrepresent a half-step
 * tier the same way it would for the PhD discount.
 */
export function getUpgradeEffectLabel(def: UpgradeDefinition): string {
  switch (def.family) {
    case "flat":
      return `+${formatNumber(def.effect)}`;
    case "multiplier":
      return `×${def.effect}`;
    case "synergy":
      return `+${formatPercent(def.effect * 100)}%`;
    case "crit":
      return `${formatPercent((def.critChance ?? 0) * 100)}% ×${def.critMultiplier}`;
    case "boosterDuration":
    case "boosterSpawn":
      return `+${formatPercent(def.effect * 100)}%`;
    default:
      return "";
  }
}
