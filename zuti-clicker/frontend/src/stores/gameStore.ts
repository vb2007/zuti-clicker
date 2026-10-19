import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import {
  UNIT_DEFINITIONS,
  UPGRADE_DEFINITIONS,
  BOOSTER_DEFINITIONS,
  BASE_TOKENS_PER_CLICK,
  UNIT_REVEAL_FRACTION,
  UPGRADE_REVEAL_FRACTION
} from "@/utils/gameConstants";
import { getUnitCost, getBulkCost, getMaxBuyable } from "@/utils/costCalculator";
import { getPhdGain, getTokensToNextPhd, getPrestigeProgress } from "@/utils/prestige";
import {
  getFlatClickBonus,
  getClickMultiplier,
  getClickSynergy,
  getCritChance,
  getCritMultiplier,
  getBoosterDurationMultiplier,
  getBoosterSpawnMultiplier,
  getActiveBoosterMultiplier,
  isBoosterKindActive,
  getClickValue,
  rollCrit
} from "@/utils/upgrades";
import {
  CAREER_NODES_BY_ID,
  getCareerModifiers,
  careerBuyRefusal,
  refundClosure,
  applyPhdGainBonus,
  keptUnitCount,
  type KeptUpgradeFamily
} from "@/utils/careerCore";
import {
  getCareerPhdProductionMultiplier,
  getCareerPhdCostMultiplier,
  getCareerProductionMultiplier,
  getCareerBaseTps,
  getCareerUnitCostMultiplier,
  getCareerUpgradeCost,
  getCareerClickSynergy,
  getBoosterSpawnDivisor
} from "@/utils/careerEconomy";
import type { CareerStateData } from "@/lib/api";
import type { UnitState, Multiplier, ActiveBoosterState, UpgradeFamily } from "@/types";

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
  // The upgrader's spin counter (see utils/upgrader.ts / POST /upgrader/spin).
  // Absent on saves written before it existed, which is the same as 0.
  upgraderSeq?: number;
}

// GET /save additionally carries read-only booster state that is NEVER part
// of a PUT /save request body (see toSavePayload) — a client cannot assert or
// extend a buff, only POST /boosters/claim can create one. `remainingMs`,
// not an absolute timestamp: the client anchors it to its own clock the
// instant it's loaded, so server/client clock skew can't extend a buff.
export interface LoadedGameSave extends GameSaveInput {
  activeBoosters?: { boosterId: string; remainingMs: number }[];
  // Read-only too: the Academic Career changes only through POST /career/*.
  // Absent from an API that predates it — an empty tree with no window.
  career?: CareerStateData;
}

// Lecture momentum (an Academic Career mechanic): each click adds this much
// to a 0..1 meter, which starts draining once no click has landed for
// MOMENTUM_GRACE_MS. The click value is scaled by (1 + momentumMax x meter).
// Client-only — the save envelope simply assumes a full meter.
export const MOMENTUM_PER_CLICK = 0.03;
export const MOMENTUM_GRACE_MS = 1500;
export const MOMENTUM_DECAY_PER_SEC = 0.5;

function upgradeFamilyKept(family: UpgradeFamily, kept: readonly KeptUpgradeFamily[]): boolean {
  const asKept = family === "boosterDuration" || family === "boosterSpawn" ? "booster" : family;
  return kept.includes(asKept);
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

  // Upgrader (the PhD wheel). upgraderSeq is the server's spin counter, echoed
  // back on every PUT /save so a save made before a later spin is told apart
  // from a current one (see saveStore). It only changes through
  // applySpinResult/loadFromSave — never by the player's own actions.
  const upgraderSeq = ref(0);
  // True from the moment a spin starts (before its pre-spin save flush) until
  // its result is applied. Purchases and prestige are refused meanwhile: the
  // flush is what the server validates the pre-spin state against, so
  // spending at the old PhD discount after it and before the result lands
  // would look, to the server, like paying less than the cheapest price.
  const spinPending = ref(false);
  // While set, the PhD readouts show this instead of phdCount, so the number
  // behind the wheel's backdrop doesn't give away the result before the wheel
  // stops. Display only — phdCount itself (and so every multiplier derived
  // from it) already reflects the spin, matching the server from that instant.
  const phdDisplayHold = ref<number | null>(null);
  // A guest's wheel results (net PhDs won minus lost), which do NOT carry over to
  // an account: the server has no record of them, so its plausibility envelope
  // would read wheel-won PhDs as forged. Dropped by forfeitGuestSpins() at login.
  const guestUpgraderNet = ref(0);
  // Bumped by hardReset (delete save / reset). A spin that was in flight across a
  // reset must not write its result onto the fresh game — see useUpgrader.
  const resetEpoch = ref(0);
  const phdCountDisplay = computed(() => phdDisplayHold.value ?? phdCount.value);

  const unitStates = ref<UnitState[]>(UNIT_DEFINITIONS.map((d) => ({ id: d.id, owned: 0 })));

  // Academic Career — the persistent PhD tree. Survives prestige; cleared only
  // by hardReset. Logged in, every change comes from the server (applyCareerState);
  // a guest's is settled locally (buyCareerNodeLocal & co.). `refundable` marks
  // nodes bought in the still-open current purchase window.
  const careerNodes = ref<{ nodeId: string; cost: number; refundable: boolean }[]>([]);
  const careerWindowOpen = ref(false);
  const careerWindowId = ref(0);
  // True from the moment a career change starts (before its pre-change save
  // flush) until its result is applied — same contract as spinPending: a
  // purchase in between would be checked by the server against the new PhD
  // discount it hasn't been told about yet.
  const careerPending = ref(false);
  // PhDs that the tree's PhD-gain bonus added to prestiges since the last
  // server load. A guest's tree doesn't carry over to an account (the server
  // has no record of it), so neither may what it earned — see forfeitGuestCareer.
  const careerBonusPhdSinceLoad = ref(0);
  // Lecture momentum meter (0..1) and when the last manual click landed.
  const momentum = ref(0);
  let lastClickAt = 0;

  // One-time click-power purchases — reset by prestige, same lifecycle as
  // unitStates (see prestige() below).
  const ownedUpgrades = ref<string[]>([]);

  // Server-issued (or, for guests, locally rolled — see composables/useBoosters.ts)
  // timed buffs. Survive prestige (a live buff is a timed event, not
  // progression); cleared only by hardReset.
  const activeBoosters = ref<ActiveBoosterState[]>([]);

  const careerNodeIds = computed(() => careerNodes.value.map((n) => n.nodeId));
  // Every Academic Career effect, folded once (see utils/careerCore.ts).
  const careerModifiers = computed(() => getCareerModifiers(careerNodeIds.value));
  const phdInvested = computed(() => careerNodes.value.reduce((sum, n) => sum + n.cost, 0));
  // Held + invested: what the "phd" leaderboard ranks.
  const phdTotal = computed(() => phdCount.value + phdInvested.value);
  const serverActionPending = computed(() => spinPending.value || careerPending.value);

  // The held-PhD bonus (with the tree's per-PhD bonus) — applied to BOTH
  // tokensPerSecond and the click's base part, like it always was.
  const productionMultiplier = computed(() =>
    getCareerPhdProductionMultiplier(phdCount.value, careerModifiers.value)
  );
  // The tree's own production multiplier — tokens/sec only.
  const careerProductionMultiplier = computed(() =>
    getCareerProductionMultiplier(careerModifiers.value)
  );
  // PhD-only cost multiplier — kept as the permanent, prestige-derived figure
  // that PrestigePanel/PrestigeConfirmModal display and compare before/after.
  // The tree's unit discount and a transient booster discount are folded in
  // separately via effectiveCostMultiplier below, which purchases actually use.
  const costMultiplier = computed(() =>
    getCareerPhdCostMultiplier(phdCount.value, careerModifiers.value)
  );

  const baseTokensPerSecond = computed(() =>
    getCareerBaseTps(
      unitStates.value.map((u) => ({ unitId: u.id, owned: u.owned })),
      careerModifiers.value
    )
  );

  // Click-power upgrade derivations (see utils/upgrades.ts for the formulas),
  // each widened by its Academic Career counterpart.
  const flatClickBonus = computed(() => getFlatClickBonus(ownedUpgrades.value));
  const clickMultiplier = computed(
    () => getClickMultiplier(ownedUpgrades.value) * careerModifiers.value.clickMult
  );
  const clickSynergy = computed(() =>
    getCareerClickSynergy(getClickSynergy(ownedUpgrades.value), careerModifiers.value)
  );
  // Booster-system perks (affect how the booster system itself behaves, not
  // the click formula directly) — read by composables/useBoosters.ts.
  const boosterDurationMultiplier = computed(
    () => getBoosterDurationMultiplier(ownedUpgrades.value) + careerModifiers.value.boosterDurationPct
  );
  // The divisor of the average wait between spawns (newsletter + tree, capped).
  const boosterSpawnMultiplier = computed(() =>
    getBoosterSpawnDivisor(getBoosterSpawnMultiplier(ownedUpgrades.value), careerModifiers.value)
  );
  const boosterWindowMultiplier = computed(() => 1 + careerModifiers.value.boosterWindowPct);

  // Live-buff multipliers, derived from activeBoosters (see grantBooster and
  // the expiry sweep in tick()). Date.now() is read fresh every time one of
  // these recomputes, which only happens when activeBoosters.value itself
  // changes (a new grant, or a sweep removing an expired entry) — the
  // multiplier value has no reason to change in between, so this is not a
  // "read the clock every frame" anti-pattern.
  function boosterMultiplier(kind: "production" | "click" | "costReduction") {
    return computed(() =>
      getActiveBoosterMultiplier(activeBoosters.value, Date.now(), kind, careerModifiers.value)
    );
  }
  const boosterProductionMultiplier = boosterMultiplier("production");
  const boosterClickMultiplier = boosterMultiplier("click");
  const boosterCostMultiplier = boosterMultiplier("costReduction");
  // Crit Storm (a career booster): +its chance to every click's crit roll.
  const boosterCritActive = computed(() =>
    isBoosterKindActive(activeBoosters.value, Date.now(), "crit")
  );
  const critChance = computed(() =>
    Math.min(
      1,
      getCritChance(ownedUpgrades.value) +
        careerModifiers.value.critChanceAdd +
        (boosterCritActive.value
          ? (BOOSTER_DEFINITIONS.find((d) => d.kind === "crit")?.multiplier ?? 0)
          : 0)
    )
  );
  const critMultiplier = computed(
    () => getCritMultiplier(ownedUpgrades.value) + careerModifiers.value.critMultAdd
  );
  // "Is a booster of this kind currently active" booleans — centralized here
  // rather than each UI component re-deriving its own >1/<1 threshold check
  // against the raw multiplier above (StatusColumn's boosted stat badges,
  // UnitCard's discounted price tint, UnitsPanel's discount chip all read
  // these instead).
  const boosterProductionActive = computed(() => boosterProductionMultiplier.value > 1);
  const boosterClickActive = computed(() => boosterClickMultiplier.value > 1);
  const boosterCostReductionActive = computed(() => boosterCostMultiplier.value < 1);
  // What unit purchases actually pay: the permanent PhD discount, the tree's
  // unit discount and any transient booster discount, never below the floor
  // (see costMultiplier's comment above for why they are kept separate).
  const effectiveCostMultiplier = computed(() =>
    getCareerUnitCostMultiplier(phdCount.value, careerModifiers.value, boosterCostMultiplier.value)
  );

  const tokensPerSecond = computed(
    () =>
      baseTokensPerSecond.value *
      productionMultiplier.value *
      careerProductionMultiplier.value *
      boosterProductionMultiplier.value
  );
  const clickValueParams = computed(() => ({
    flatClickBonus: flatClickBonus.value,
    clickMultiplier: clickMultiplier.value,
    phdProductionMultiplier: productionMultiplier.value,
    tokensPerSecond: tokensPerSecond.value,
    clickSynergy: clickSynergy.value
  }));
  // Non-crit, no-momentum click value — what StatusColumn's "Per Click" stat
  // shows; clickToken() scales it by momentum and, on a crit, critMultiplier.
  const tokensPerClick = computed(() =>
    getClickValue({
      ...clickValueParams.value,
      boosterClickMultiplier: boosterClickMultiplier.value
    })
  );
  const momentumMultiplier = computed(
    () => 1 + careerModifiers.value.momentumMax * momentum.value
  );
  // Teaching Assistants: passive auto-clicks per second, each worth a plain
  // click — no crit, no momentum, no click booster. Income only: they never
  // count as clicks (totalClicks, run stats, anti-cheat click telemetry).
  const autoClickIncome = computed(
    () =>
      careerModifiers.value.autoClickRate *
      getClickValue({ ...clickValueParams.value, boosterClickMultiplier: 1 })
  );

  const phdGain = computed(() =>
    applyPhdGainBonus(getPhdGain(runTokensEarned.value), careerModifiers.value.phdGainBp)
  );
  const canPrestige = computed(() => phdGain.value >= 1);
  const prestigeProgress = computed(() => getPrestigeProgress(runTokensEarned.value));
  const tokensToNextPhd = computed(() => getTokensToNextPhd(runTokensEarned.value));

  function clickToken(): { earned: number; crit: boolean } {
    // The game is paused while the Academic Career purchase window is open
    // (see tick()) — a click can't start the new run either.
    if (antiCheat.isRestricted || careerWindowOpen.value) return { earned: 0, crit: false };
    if (careerModifiers.value.momentumMax > 0) {
      momentum.value = Math.min(1, momentum.value + MOMENTUM_PER_CLICK);
      lastClickAt = Date.now();
    }
    const crit = rollCrit(critChance.value);
    const base = tokensPerClick.value * momentumMultiplier.value;
    const earned = crit ? base * critMultiplier.value : base;
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
    if (antiCheat.isRestricted || serverActionPending.value) return false;
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

  /** An upgrade's price right now (the Academic Career's upgrade discount applied). */
  function getUpgradeCost(upgradeId: string): number {
    const def = UPGRADE_DEFINITIONS.find((d) => d.id === upgradeId);
    return def ? getCareerUpgradeCost(def.cost, careerModifiers.value) : 0;
  }

  function canAffordUpgrade(upgradeId: string): boolean {
    const def = UPGRADE_DEFINITIONS.find((d) => d.id === upgradeId);
    if (!def || isUpgradeOwned(upgradeId)) return false;
    return tokens.value >= getUpgradeCost(upgradeId);
  }

  /** One-time purchase. Returns false (and mutates nothing) if unknown, already owned, or unaffordable. */
  function buyUpgrade(upgradeId: string): boolean {
    if (antiCheat.isRestricted || serverActionPending.value) return false;
    const def = UPGRADE_DEFINITIONS.find((d) => d.id === upgradeId);
    if (!def || isUpgradeOwned(upgradeId)) return false;
    const cost = getUpgradeCost(upgradeId);
    if (tokens.value < cost) return false;
    tokens.value -= cost;
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
    // Paused while the Academic Career purchase window is open: the new run
    // starts only once the player is done investing. The server relies on it —
    // a save showing run time or clicks while the window is open ends the
    // window (api/src/constants/career.ts), so nodes bought "at the prestige"
    // can't be used for a run and refunded before the next one.
    if (antiCheat.isRestricted || careerWindowOpen.value) return;
    const earned = (tokensPerSecond.value + autoClickIncome.value) * delta;
    if (momentum.value > 0 && Date.now() - lastClickAt > MOMENTUM_GRACE_MS) {
      momentum.value = Math.max(0, momentum.value - MOMENTUM_DECAY_PER_SEC * delta);
    }
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

  /**
   * Applies a settled spin: the server's (or, for a guest, the local) PhD
   * balance and spin counter. Takes the resulting values rather than a delta so
   * the client can never drift from what the server actually stored.
   */
  function applySpinResult(newPhdCount: number, newUpgraderSeq: number): void {
    phdCount.value = newPhdCount;
    upgraderSeq.value = newUpgraderSeq;
  }

  function recordGuestSpin(delta: number): void {
    guestUpgraderNet.value += delta;
  }

  /**
   * Undoes every wheel result made as a guest, returning the net that was
   * removed (0 if there was none). Called when the player logs in, so the first
   * save an account ever makes carries only PhDs that prestige explains.
   */
  function forfeitGuestSpins(): number {
    const net = guestUpgraderNet.value;
    if (net === 0) return 0;
    phdCount.value -= net;
    guestUpgraderNet.value = 0;
    return net;
  }

  function holdPhdDisplay(value: number): void {
    phdDisplayHold.value = value;
  }

  function releasePhdDisplay(): void {
    phdDisplayHold.value = null;
  }

  /**
   * Banks PhDs and starts a new run. Returns the PhDs gained, or 0 if refused.
   *
   * The Academic Career shapes the new run with the nodes owned right now: a
   * share of every unit and whole upgrade families survive, the run starts
   * with a token fund (which is NOT counted as earned — it isn't), and the
   * PhD gain carries the tree's bonus. Opens a new purchase window: for a
   * logged-in player the server opens the real one when this prestige is
   * saved (and its reply is adopted), so this is just the local mirror.
   */
  function prestige(): number {
    if (antiCheat.isRestricted || serverActionPending.value) return 0;
    const gained = phdGain.value; // MUST be read before any reset below
    if (gained < 1) return 0;
    const mods = careerModifiers.value;
    careerBonusPhdSinceLoad.value += gained - getPhdGain(runTokensEarned.value);
    phdCount.value += gained;
    prestigeCount.value += 1;
    tokens.value = mods.startingTokens;
    runTokensEarned.value = 0;
    runClicks.value = 0;
    runSeconds.value = 0;
    unitStates.value.forEach((u) => {
      u.owned = keptUnitCount(u.owned, mods.keepUnitsBp);
    });
    // Upgrades are run-scoped, like units — a fresh run rebuilds its own
    // click power from scratch, except the families the tree keeps. Active
    // boosters are a timed event, not progression, so they are deliberately
    // left untouched here.
    ownedUpgrades.value = ownedUpgrades.value.filter((id) => {
      const family = UPGRADE_DEFINITIONS.find((d) => d.id === id)?.family;
      return family !== undefined && upgradeFamilyKept(family, mods.keepUpgradeFamilies);
    });
    momentum.value = 0;
    openLocalCareerWindow();
    return gained;
  }

  // ---- Academic Career -------------------------------------------------

  function openLocalCareerWindow(): void {
    careerWindowOpen.value = true;
    careerWindowId.value += 1;
    careerNodes.value = careerNodes.value.map((n) => ({ ...n, refundable: false }));
  }

  /** Adopts the server's career state (and, when given, its PhD balance and counter) as-is. */
  function applyCareerState(state: {
    phdCount?: number;
    upgraderSeq?: number;
    career: CareerStateData;
  }): void {
    if (state.phdCount !== undefined) phdCount.value = state.phdCount;
    if (state.upgraderSeq !== undefined) upgraderSeq.value = state.upgraderSeq;
    careerNodes.value = state.career.nodes
      .filter((n) => CAREER_NODES_BY_ID.has(n.nodeId))
      .map((n) => ({ nodeId: n.nodeId, cost: n.cost, refundable: n.refundable }));
    careerWindowOpen.value = state.career.windowOpen;
    careerWindowId.value = state.career.windowId;
  }

  /** The window state a PUT /save reply reports (a save carrying a prestige opens one). */
  function applyCareerWindow(windowOpen: boolean, windowId: number): void {
    if (windowId !== careerWindowId.value && windowOpen) {
      careerNodes.value = careerNodes.value.map((n) => ({ ...n, refundable: false }));
    }
    careerWindowOpen.value = windowOpen;
    careerWindowId.value = windowId;
  }

  /** A guest's purchase, settled locally with the same rules the server applies. */
  function buyCareerNodeLocal(nodeId: string): boolean {
    if (antiCheat.isRestricted || serverActionPending.value || !careerWindowOpen.value) return false;
    if (careerBuyRefusal(nodeId, careerNodeIds.value, phdCount.value) !== null) return false;
    const cost = CAREER_NODES_BY_ID.get(nodeId)!.cost;
    phdCount.value -= cost;
    careerNodes.value = [...careerNodes.value, { nodeId, cost, refundable: true }];
    return true;
  }

  /** The nodes a refund of `nodeId` would remove right now (null: not refundable). */
  function careerRefundPreview(nodeId: string): { nodeIds: string[]; phd: number } | null {
    if (!careerWindowOpen.value) return null;
    const removed = refundClosure(
      nodeId,
      careerNodeIds.value,
      careerNodes.value.filter((n) => n.refundable).map((n) => n.nodeId)
    );
    if (removed === null) return null;
    const set = new Set(removed);
    const phd = careerNodes.value.filter((n) => set.has(n.nodeId)).reduce((s, n) => s + n.cost, 0);
    return { nodeIds: removed, phd };
  }

  /** A guest's refund (cascading), settled locally. */
  function refundCareerNodeLocal(nodeId: string): boolean {
    if (antiCheat.isRestricted || serverActionPending.value) return false;
    const preview = careerRefundPreview(nodeId);
    if (!preview) return false;
    const set = new Set(preview.nodeIds);
    careerNodes.value = careerNodes.value.filter((n) => !set.has(n.nodeId));
    phdCount.value += preview.phd;
    return true;
  }

  function closeCareerWindowLocal(): void {
    careerWindowOpen.value = false;
    careerNodes.value = careerNodes.value.map((n) => ({ ...n, refundable: false }));
  }

  /**
   * Undoes a guest's whole tree at login (the server has no record of it, so a
   * first save carrying it would read as forged): every node is refunded, the
   * PhDs its PhD-gain bonus added are removed, and the local window closed.
   * Returns whether there was anything to undo.
   */
  function forfeitGuestCareer(): boolean {
    const hadAny = careerNodes.value.length > 0 || careerBonusPhdSinceLoad.value > 0;
    phdCount.value = Math.max(0, phdCount.value + phdInvested.value - careerBonusPhdSinceLoad.value);
    careerNodes.value = [];
    careerBonusPhdSinceLoad.value = 0;
    careerWindowOpen.value = false;
    return hadAny;
  }

  /** A server-credited windfall booster: the tokens it already added to the save, and the new counter. */
  function applyWindfall(granted: number, newUpgraderSeq?: number): void {
    tokens.value += granted;
    totalTokensEarned.value += granted;
    runTokensEarned.value += granted;
    if (newUpgraderSeq !== undefined) upgraderSeq.value = newUpgraderSeq;
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
    upgraderSeq.value = 0;
    phdDisplayHold.value = null;
    guestUpgraderNet.value = 0;
    resetEpoch.value++;
    unitStates.value.forEach((u) => {
      u.owned = 0;
    });
    ownedUpgrades.value = [];
    activeBoosters.value = [];
    careerNodes.value = [];
    careerWindowOpen.value = false;
    careerWindowId.value = 0;
    careerBonusPhdSinceLoad.value = 0;
    momentum.value = 0;
  }

  function loadFromSave(save: LoadedGameSave): void {
    tokens.value = save.tokens;
    totalTokensEarned.value = save.totalTokensEarned;
    totalClicks.value = save.totalClicks;
    elapsedSeconds.value = save.elapsedSeconds;
    phdCount.value = save.phdCount ?? 0;
    prestigeCount.value = save.prestigeCount ?? 0;
    upgraderSeq.value = save.upgraderSeq ?? 0;
    phdDisplayHold.value = null;
    guestUpgraderNet.value = 0;
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
    applyCareerState({
      career: save.career ?? { windowOpen: false, windowId: 0, phdInvested: 0, nodes: [] }
    });
    careerBonusPhdSinceLoad.value = 0;
    momentum.value = 0;
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
      upgrades: ownedUpgrades.value.slice(),
      upgraderSeq: upgraderSeq.value
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
    upgraderSeq,
    spinPending,
    guestUpgraderNet,
    resetEpoch,
    phdDisplayHold,
    phdCountDisplay,
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
    careerNodes,
    careerNodeIds,
    careerWindowOpen,
    careerWindowId,
    careerPending,
    careerModifiers,
    phdInvested,
    phdTotal,
    serverActionPending,
    careerProductionMultiplier,
    boosterWindowMultiplier,
    boosterCritActive,
    momentum,
    momentumMultiplier,
    autoClickIncome,
    getUpgradeCost,
    applyCareerState,
    applyCareerWindow,
    buyCareerNodeLocal,
    careerRefundPreview,
    refundCareerNodeLocal,
    closeCareerWindowLocal,
    forfeitGuestCareer,
    applyWindfall,
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
    applySpinResult,
    recordGuestSpin,
    forfeitGuestSpins,
    holdPhdDisplay,
    releasePhdDisplay,
    tick,
    isUnitRevealed,
    prestige,
    hardReset,
    loadFromSave,
    toSavePayload
  };
});
