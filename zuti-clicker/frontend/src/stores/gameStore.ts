import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import {
  UNIT_DEFINITIONS,
  UPGRADE_DEFINITIONS,
  BASE_TOKENS_PER_CLICK,
  UNIT_REVEAL_FRACTION,
  UPGRADE_REVEAL_FRACTION
} from "@/utils/gameConstants";
import { getUnitCost, getBulkCost, getMaxBuyable } from "@/utils/costCalculator";
import {
  getPhdGain,
  getProductionMultiplier,
  getCostMultiplier,
  getTokensToNextPhd,
  getPrestigeProgress
} from "@/utils/prestige";
import {
  getFlatClickBonus,
  getClickMultiplier,
  getClickSynergy,
  getCritChance,
  getCritMultiplier,
  getBoosterDurationMultiplier,
  getBoosterSpawnMultiplier,
  getActiveBoosterMultiplier,
  getClickValue,
  rollCrit
} from "@/utils/upgrades";
import type { UnitState, Multiplier, ActiveBoosterState, BoosterKind } from "@/types";

export interface GameSaveInput {
  tokens: number;
  totalTokensEarned: number;
  totalClicks: number;
  elapsedSeconds: number;
  units: { unitId: string; owned: number }[];
  // Absent on saves written before the prestige system existed.
  runTokensEarned?: number;
  runClicks?: number;
  runSeconds?: number;
  phdCount?: number;
  prestigeCount?: number;
  // Absent on saves written before the upgrades system existed.
  upgrades?: string[];
}

// GET /save additionally carries read-only booster state that is NEVER part
// of a PUT /save request body (see toSavePayload) — a client cannot assert or
// extend a buff, only POST /boosters/claim can create one. `remainingMs`,
// not an absolute timestamp: the client anchors it to its own clock the
// instant it's loaded, so server/client clock skew can't extend a buff.
export interface LoadedGameSave extends GameSaveInput {
  activeBoosters?: { boosterId: string; remainingMs: number }[];
}

export const useGameStore = defineStore("game", () => {
  // The single anti-cheat gate every progress-affecting action below checks —
  // see stores/antiCheatStore.ts. Centralized here rather than repeated in
  // every calling component so it can never be bypassed by calling this
  // store directly (devtools console, a tampered component, etc.): clicking,
  // buying, prestiging, and idle income are all no-ops while restricted.
  const antiCheat = useAntiCheatStore();

  // Lifetime — survives prestige, never reset except by hardReset.
  const tokens = ref(0);
  const totalTokensEarned = ref(0);
  const totalClicks = ref(0);
  const elapsedSeconds = ref(0);

  // Current run — reset by prestige.
  const runTokensEarned = ref(0);
  const runClicks = ref(0);
  const runSeconds = ref(0);

  // Prestige — survives prestige, cleared only by hardReset.
  const phdCount = ref(0);
  const prestigeCount = ref(0);

  const unitStates = ref<UnitState[]>(UNIT_DEFINITIONS.map((d) => ({ id: d.id, owned: 0 })));

  // One-time click-power purchases — reset by prestige, same lifecycle as
  // unitStates (see prestige() below).
  const ownedUpgrades = ref<string[]>([]);

  // Server-issued (or, for guests, locally rolled — see composables/useBoosters.ts)
  // timed buffs. Survive prestige (a live buff is a timed event, not
  // progression); cleared only by hardReset.
  const activeBoosters = ref<ActiveBoosterState[]>([]);

  const productionMultiplier = computed(() => getProductionMultiplier(phdCount.value));
  // PhD-only cost multiplier — kept as the permanent, prestige-derived figure
  // that PrestigePanel/PrestigeConfirmModal display and compare before/after.
  // A transient booster discount is folded in separately via
  // effectiveCostMultiplier below, which is what purchases actually use.
  const costMultiplier = computed(() => getCostMultiplier(phdCount.value));

  const baseTokensPerSecond = computed(() =>
    UNIT_DEFINITIONS.reduce((sum, def) => {
      const state = unitStates.value.find((u) => u.id === def.id);
      return sum + (state?.owned ?? 0) * def.baseProduction;
    }, 0)
  );

  // Click-power upgrade derivations (see utils/upgrades.ts for the formulas).
  const flatClickBonus = computed(() => getFlatClickBonus(ownedUpgrades.value));
  const clickMultiplier = computed(() => getClickMultiplier(ownedUpgrades.value));
  const clickSynergy = computed(() => getClickSynergy(ownedUpgrades.value));
  const critChance = computed(() => getCritChance(ownedUpgrades.value));
  const critMultiplier = computed(() => getCritMultiplier(ownedUpgrades.value));
  // Booster-system perks (affect how the booster system itself behaves, not
  // the click formula directly) — read by composables/useBoosters.ts.
  const boosterDurationMultiplier = computed(() => getBoosterDurationMultiplier(ownedUpgrades.value));
  const boosterSpawnMultiplier = computed(() => getBoosterSpawnMultiplier(ownedUpgrades.value));

  // Live-buff multipliers, derived from activeBoosters (see grantBooster and
  // the expiry sweep in tick()). Date.now() is read fresh every time one of
  // these recomputes, which only happens when activeBoosters.value itself
  // changes (a new grant, or a sweep removing an expired entry) — the
  // multiplier value has no reason to change in between, so this is not a
  // "read the clock every frame" anti-pattern.
  function boosterMultiplier(kind: BoosterKind) {
    return computed(() => getActiveBoosterMultiplier(activeBoosters.value, Date.now(), kind));
  }
  const boosterProductionMultiplier = boosterMultiplier("production");
  const boosterClickMultiplier = boosterMultiplier("click");
  const boosterCostMultiplier = boosterMultiplier("costReduction");
  // "Is a booster of this kind currently active" booleans — centralized here
  // rather than each UI component re-deriving its own >1/<1 threshold check
  // against the raw multiplier above (StatusColumn's boosted stat badges,
  // UnitCard's discounted price tint, UnitsPanel's discount chip all read
  // these instead).
  const boosterProductionActive = computed(() => boosterProductionMultiplier.value > 1);
  const boosterClickActive = computed(() => boosterClickMultiplier.value > 1);
  const boosterCostReductionActive = computed(() => boosterCostMultiplier.value < 1);
  // What unit purchases actually pay: the permanent PhD discount stacked
  // with any transient booster discount (see costMultiplier's comment above
  // for why the two are kept separate).
  const effectiveCostMultiplier = computed(() => costMultiplier.value * boosterCostMultiplier.value);

  const tokensPerSecond = computed(
    () => baseTokensPerSecond.value * productionMultiplier.value * boosterProductionMultiplier.value
  );
  // Non-crit expected click value — what StatusColumn's "Per Click" stat
  // shows, and what clickToken() multiplies by critMultiplier on a crit roll.
  const tokensPerClick = computed(() =>
    getClickValue({
      flatClickBonus: flatClickBonus.value,
      clickMultiplier: clickMultiplier.value,
      phdProductionMultiplier: productionMultiplier.value,
      tokensPerSecond: tokensPerSecond.value,
      clickSynergy: clickSynergy.value,
      boosterClickMultiplier: boosterClickMultiplier.value
    })
  );

  const phdGain = computed(() => getPhdGain(runTokensEarned.value));
  const canPrestige = computed(() => phdGain.value >= 1);
  const prestigeProgress = computed(() => getPrestigeProgress(runTokensEarned.value));
  const tokensToNextPhd = computed(() => getTokensToNextPhd(runTokensEarned.value));

  function clickToken(): { earned: number; crit: boolean } {
    if (antiCheat.isRestricted) return { earned: 0, crit: false };
    const crit = rollCrit(critChance.value);
    const earned = crit ? tokensPerClick.value * critMultiplier.value : tokensPerClick.value;
    tokens.value += earned;
    totalTokensEarned.value += earned;
    runTokensEarned.value += earned;
    totalClicks.value++;
    runClicks.value++;
    return { earned, crit };
  }

  function _resolveAmount(unitId: string, multiplier: Multiplier): number {
    const def = UNIT_DEFINITIONS.find((d) => d.id === unitId);
    if (!def) return 0;
    const owned = unitStates.value.find((u) => u.id === unitId)?.owned ?? 0;
    if (multiplier === "max")
      return getMaxBuyable(def, owned, tokens.value, effectiveCostMultiplier.value);
    return multiplier;
  }

  function getBuyCost(unitId: string, multiplier: Multiplier): number {
    const def = UNIT_DEFINITIONS.find((d) => d.id === unitId);
    if (!def) return 0;
    const owned = unitStates.value.find((u) => u.id === unitId)?.owned ?? 0;
    const amount =
      multiplier === "max"
        ? getMaxBuyable(def, owned, tokens.value, effectiveCostMultiplier.value)
        : multiplier;
    if (amount <= 0) return getUnitCost(def, owned, effectiveCostMultiplier.value);
    return getBulkCost(def, owned, amount, effectiveCostMultiplier.value);
  }

  function getProductionGain(unitId: string, multiplier: Multiplier): number {
    const def = UNIT_DEFINITIONS.find((d) => d.id === unitId);
    if (!def) return 0;
    const amount = _resolveAmount(unitId, multiplier);
    return amount * def.baseProduction;
  }

  function canAfford(unitId: string, multiplier: Multiplier): boolean {
    const def = UNIT_DEFINITIONS.find((d) => d.id === unitId);
    if (!def) return false;
    const owned = unitStates.value.find((u) => u.id === unitId)?.owned ?? 0;
    if (multiplier === "max")
      return getMaxBuyable(def, owned, tokens.value, effectiveCostMultiplier.value) > 0;
    return getBulkCost(def, owned, multiplier, effectiveCostMultiplier.value) <= tokens.value;
  }

  function buyUnit(unitId: string, multiplier: Multiplier): boolean {
    if (antiCheat.isRestricted) return false;
    const def = UNIT_DEFINITIONS.find((d) => d.id === unitId);
    if (!def) return false;
    const state = unitStates.value.find((u) => u.id === unitId);
    if (!state) return false;
    const amount =
      multiplier === "max"
        ? getMaxBuyable(def, state.owned, tokens.value, effectiveCostMultiplier.value)
        : multiplier;
    if (amount <= 0) return false;
    const cost = getBulkCost(def, state.owned, amount, effectiveCostMultiplier.value);
    if (tokens.value < cost) return false;
    tokens.value -= cost;
    state.owned += amount;
    return true;
  }

  /**
   * Reveal is a one-way discovery gate, not an affordability gate — same rule
   * as isUnitRevealed, keyed to the upgrade's own (undiscounted) cost.
   */
  function isUpgradeRevealed(upgradeId: string): boolean {
    const def = UPGRADE_DEFINITIONS.find((d) => d.id === upgradeId);
    if (!def) return false;
    return totalTokensEarned.value >= def.cost * UPGRADE_REVEAL_FRACTION;
  }

  function isUpgradeOwned(upgradeId: string): boolean {
    return ownedUpgrades.value.includes(upgradeId);
  }

  function canAffordUpgrade(upgradeId: string): boolean {
    const def = UPGRADE_DEFINITIONS.find((d) => d.id === upgradeId);
    if (!def || isUpgradeOwned(upgradeId)) return false;
    return tokens.value >= def.cost;
  }

  /** One-time purchase. Returns false (and mutates nothing) if unknown, already owned, or unaffordable. */
  function buyUpgrade(upgradeId: string): boolean {
    if (antiCheat.isRestricted) return false;
    const def = UPGRADE_DEFINITIONS.find((d) => d.id === upgradeId);
    if (!def || isUpgradeOwned(upgradeId)) return false;
    if (tokens.value < def.cost) return false;
    tokens.value -= def.cost;
    ownedUpgrades.value.push(upgradeId);
    return true;
  }

  /**
   * Applies a claimed/rolled booster. `remainingMs` (not an absolute expiry)
   * so the caller — the server's claim response, or a guest's local roll —
   * never hands this store a timestamp to blindly trust; it's anchored to
   * Date.now() right here, at the moment of grant. Reclaiming an
   * already-active booster refreshes its timer rather than stacking a second entry.
   */
  function grantBooster(boosterId: string, remainingMs: number): void {
    const expiresAt = Date.now() + Math.max(0, remainingMs);
    const existing = activeBoosters.value.find((b) => b.id === boosterId);
    if (existing) existing.expiresAt = expiresAt;
    else activeBoosters.value.push({ id: boosterId, expiresAt });
  }

  function _sweepExpiredBoosters(): void {
    const now = Date.now();
    if (activeBoosters.value.some((b) => b.expiresAt <= now)) {
      activeBoosters.value = activeBoosters.value.filter((b) => b.expiresAt > now);
    }
  }

  function tick(delta: number) {
    if (antiCheat.isRestricted) return;
    const earned = tokensPerSecond.value * delta;
    tokens.value += earned;
    totalTokensEarned.value += earned;
    runTokensEarned.value += earned;
    elapsedSeconds.value += delta;
    runSeconds.value += delta;
    _sweepExpiredBoosters();
  }

  /**
   * Reveal is a one-way discovery gate, not an affordability gate: it is keyed
   * to lifetime totals and the undiscounted base cost, so a unit stays
   * revealed after a prestige instead of re-hiding, and the discount doesn't
   * change when it first appears.
   */
  function isUnitRevealed(unitId: string): boolean {
    const idx = UNIT_DEFINITIONS.findIndex((d) => d.id === unitId);
    if (idx <= 0) return idx === 0;
    const def = UNIT_DEFINITIONS[idx];
    return totalTokensEarned.value >= (def?.baseCost ?? Infinity) * UNIT_REVEAL_FRACTION;
  }

  /** Banks PhDs and starts a new run. Returns the PhDs gained, or 0 if refused. */
  function prestige(): number {
    if (antiCheat.isRestricted) return 0;
    const gained = phdGain.value; // MUST be read before any reset below
    if (gained < 1) return 0;
    phdCount.value += gained;
    prestigeCount.value += 1;
    tokens.value = 0;
    runTokensEarned.value = 0;
    runClicks.value = 0;
    runSeconds.value = 0;
    unitStates.value.forEach((u) => {
      u.owned = 0;
    });
    // Upgrades are run-scoped, like units — a fresh run rebuilds its own
    // click power from scratch. Active boosters are a timed event, not
    // progression, so they are deliberately left untouched here.
    ownedUpgrades.value = [];
    return gained;
  }

  /** Wipes everything, including PhDs. Used by the prestige-free "delete save" flow. */
  function hardReset(): void {
    tokens.value = 0;
    totalTokensEarned.value = 0;
    totalClicks.value = 0;
    elapsedSeconds.value = 0;
    runTokensEarned.value = 0;
    runClicks.value = 0;
    runSeconds.value = 0;
    phdCount.value = 0;
    prestigeCount.value = 0;
    unitStates.value.forEach((u) => {
      u.owned = 0;
    });
    ownedUpgrades.value = [];
    activeBoosters.value = [];
  }

  function loadFromSave(save: LoadedGameSave): void {
    tokens.value = save.tokens;
    totalTokensEarned.value = save.totalTokensEarned;
    totalClicks.value = save.totalClicks;
    elapsedSeconds.value = save.elapsedSeconds;
    phdCount.value = save.phdCount ?? 0;
    prestigeCount.value = save.prestigeCount ?? 0;
    // A save with no run counters predates prestige, so it IS a single
    // un-prestiged run: run totals equal lifetime totals. `??` (not `||`) so a
    // genuine post-prestige 0 is preserved rather than re-seeded from lifetime.
    runTokensEarned.value = save.runTokensEarned ?? save.totalTokensEarned;
    runClicks.value = save.runClicks ?? save.totalClicks;
    runSeconds.value = save.runSeconds ?? save.elapsedSeconds;
    unitStates.value.forEach((u) => {
      u.owned = 0;
    });
    for (const { unitId, owned } of save.units) {
      const state = unitStates.value.find((u) => u.id === unitId);
      if (state) state.owned = owned;
    }
    ownedUpgrades.value = save.upgrades ?? [];
    // Anchor each restored booster's remaining time to THIS client's clock,
    // right now — never trust a stored/served absolute timestamp directly.
    activeBoosters.value = (save.activeBoosters ?? []).map((b) => ({
      id: b.boosterId,
      expiresAt: Date.now() + Math.max(0, b.remainingMs)
    }));
  }

  function toSavePayload(): GameSaveInput {
    return {
      tokens: tokens.value,
      totalTokensEarned: totalTokensEarned.value,
      totalClicks: totalClicks.value,
      elapsedSeconds: elapsedSeconds.value,
      runTokensEarned: runTokensEarned.value,
      runClicks: runClicks.value,
      runSeconds: runSeconds.value,
      phdCount: phdCount.value,
      prestigeCount: prestigeCount.value,
      units: unitStates.value.map((u) => ({ unitId: u.id, owned: u.owned })),
      upgrades: ownedUpgrades.value.slice()
    };
  }

  return {
    tokens,
    totalTokensEarned,
    totalClicks,
    elapsedSeconds,
    runTokensEarned,
    runClicks,
    runSeconds,
    phdCount,
    prestigeCount,
    unitStates,
    ownedUpgrades,
    activeBoosters,
    productionMultiplier,
    costMultiplier,
    effectiveCostMultiplier,
    baseTokensPerSecond,
    tokensPerSecond,
    tokensPerClick,
    flatClickBonus,
    clickMultiplier,
    clickSynergy,
    critChance,
    critMultiplier,
    boosterDurationMultiplier,
    boosterSpawnMultiplier,
    boosterProductionMultiplier,
    boosterClickMultiplier,
    boosterCostMultiplier,
    boosterProductionActive,
    boosterClickActive,
    boosterCostReductionActive,
    phdGain,
    canPrestige,
    prestigeProgress,
    tokensToNextPhd,
    clickToken,
    getBuyCost,
    getProductionGain,
    canAfford,
    buyUnit,
    isUpgradeRevealed,
    isUpgradeOwned,
    canAffordUpgrade,
    buyUpgrade,
    grantBooster,
    tick,
    isUnitRevealed,
    prestige,
    hardReset,
    loadFromSave,
    toSavePayload
  };
});
