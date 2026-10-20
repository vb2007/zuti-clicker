// The save plausibility envelope — the backstop layer of the anti-cheat
// system (see the plan's "Layer 1"). Bounds every quantity a PUT /save
// request could plausibly contain, given the previous stored save and the
// wall-clock time elapsed since it, using the server-side economy mirror
// (services/economy.ts) so the bound is derived from the same balance curve
// the client itself uses — never a guessed constant.
//
// Every bound deliberately uses the most player-favourable assumptions
// (maximum possible booster/crit multipliers, cheapest possible cost
// multiplier, minimum possible spend) so a lucky or heavily-discounted
// legitimate player is never clipped. A violation up to REJECT_MULTIPLIER
// times over the bound is silently clamped down to the bound; only a
// violation beyond that, or an outright monotonicity break, is rejected.
import {
  getUnitDefinition,
  getUpgradeDefinition,
  PHD_TOKEN_SCALE,
  MAX_CRIT_MULTIPLIER,
  MAX_UNIT_OWNED,
  UNIT_DEFINITIONS,
  UPGRADE_DEFINITIONS
} from "../constants/gameBalance";
import {
  getBulkCost,
  getUnitCost,
  getFlatClickBonus,
  getClickMultiplier,
  getClickSynergy,
  getClickValue,
  getCareerPhdProductionMultiplier,
  getCareerProductionMultiplier,
  getCareerBaseTps,
  getCareerUnitCostMultiplier,
  getCareerUpgradeCost,
  getCareerClickSynergy,
  getMaxBoosterMultiplier
} from "./economy";
import { emptyCareerModifiers, keptUnitCount, type CareerModifiers } from "./careerCore";
import {
  CLOCK_GRACE_SECS,
  FIRST_SAVE_PLAYTIME_CREDIT_SECS,
  ENVELOPE_MAX_CPS,
  REJECT_MULTIPLIER,
  EARNED_ACCEPT_MARGIN,
  PHD_BOUND_SLACK,
  PRESTIGE_COUNT_SLACK,
  floatTolerance,
  SOFT_CLAMP_MATERIAL_RATIO
} from "../constants/antiCheat";

export interface UnitSnapshot {
  unitId: string;
  owned: number;
}

export interface PrevSaveSnapshot {
  tokens: number;
  totalTokensEarned: number;
  totalClicks: number;
  elapsedSeconds: number;
  phdCount: number;
  prestigeCount: number;
  // GameSave.upgraderNet: the signed sum of (payout - stake) across every
  // upgrader spin. Written only by POST /upgrader/spin, never by the client.
  upgraderNet: number;
  // GameSave.phdInvested: PhDs sunk into the Academic Career tree. Written
  // only by POST /career/*, never by the client.
  phdInvested: number;
  savedAt: Date;
  units: UnitSnapshot[];
  upgrades: string[];
  // The tree's modifiers, folded from the account's own CareerNodeSave rows
  // (never from the request). Nodes only change through POST /career/*, which
  // bumps upgraderSeq, so between two accepted saves the tree is fixed — the
  // same modifiers apply to both the pre- and post-prestige economies below.
  career: CareerModifiers;
}

export interface IncomingSave {
  tokens: number;
  totalTokensEarned: number;
  totalClicks: number;
  elapsedSeconds: number;
  phdCount: number;
  prestigeCount: number;
  units: UnitSnapshot[];
  // The RESOLVED value the write will actually use — i.e. already merged
  // with "omitted means preserve the stored list" the way upsertSave does,
  // never the raw (possibly-undefined) request field.
  upgrades: string[];
}

export interface EnvelopeClamped {
  totalTokensEarned?: number;
  totalClicks?: number;
  elapsedSeconds?: number;
  tokens?: number;
  prestigeCount?: number;
  phdCount?: number;
}

export type EnvelopeVerdict =
  | { outcome: "accept" }
  | {
      outcome: "clamp";
      clamped: EnvelopeClamped;
      reasons: string[];
      detail: Record<string, unknown>;
      // True if ANY clamped dimension's overshoot was material (see
      // SOFT_CLAMP_MATERIAL_RATIO's own comment) — the one thing
      // database/models/antiCheat.ts's recordSoftClamp needs to decide
      // whether this clamp counts toward the strike pattern at all.
      material: boolean;
    }
  | { outcome: "reject"; reason: string; detail: Record<string, unknown> };

function unitMap(units: UnitSnapshot[]): Map<string, number> {
  return new Map(units.map((u) => [u.unitId, u.owned]));
}

// Whether an upgrade survives a prestige thanks to a keepUpgradeFamily node.
// "booster" covers both booster perks (see careerCore's KeptUpgradeFamily).
function isKeptUpgrade(upgradeId: string, mods: CareerModifiers): boolean {
  const family = getUpgradeDefinition(upgradeId)?.family;
  if (!family) return false;
  const kept = family === "boosterDuration" || family === "boosterSpawn" ? "booster" : family;
  return mods.keepUpgradeFamilies.includes(kept);
}

// The two-tier bound every envelope dimension shares: within `bound` is
// fine; up to REJECT_MULTIPLIER times over is clamped down to `bound`;
// beyond that is a hard reject. `bound` is floored at 0 first so a
// theoretically-negative bound (e.g. "there was no way to afford this at
// all") still rejects on the smallest positive overage instead of comparing
// against a negative number.
//
// REJECT_ABS_SLACK guarantees the clamp band always has real width even when
// bound is exactly (or very near) 0 — bound*REJECT_MULTIPLIER is ALSO 0 in
// that case, which would otherwise collapse the clamp band to nothing and
// hard-reject a legitimate "spent every last token" save over a sub-cent
// float residue from many tick() accumulations, instead of silently
// clamping it like every other boundary case.
//
// The "ok"/"clamp" boundaries below use floatTolerance(actual, bound)
// instead of a fixed epsilon — see its own comment in constants/antiCheat.ts
// for the production incident that made a fixed floor insufficient once
// balances grew large.
const REJECT_ABS_SLACK = 1e-3;
function checkBound(
  actual: number,
  rawBound: number
): { outcome: "ok" } | { outcome: "clamp"; to: number; material: boolean } | { outcome: "reject" } {
  const bound = Math.max(0, rawBound);
  const tolerance = floatTolerance(actual, bound);
  if (actual <= bound + tolerance) return { outcome: "ok" };
  const rejectThreshold = Math.max(bound * REJECT_MULTIPLIER, bound + REJECT_ABS_SLACK);
  if (actual <= rejectThreshold + tolerance) {
    // Material = genuinely over bound, not just past this check's own
    // (much tighter) float tolerance — see SOFT_CLAMP_MATERIAL_RATIO's own
    // comment for the production incident this distinguishes from a real
    // pattern of forged/implausible saves. `bound * SOFT_CLAMP_MATERIAL_RATIO`
    // is itself 0 whenever bound is exactly 0 (e.g. a player who spent
    // every last token) — the same zero-width-band problem REJECT_ABS_SLACK
    // exists to solve for the reject threshold above, so it doubles as the
    // absolute floor here too: below it is noise even with no relative
    // reference point to compare against.
    const material = actual - bound > Math.max(bound * SOFT_CLAMP_MATERIAL_RATIO, REJECT_ABS_SLACK);
    return { outcome: "clamp", to: bound, material };
  }
  return { outcome: "reject" };
}

// The strongest possible production rate AND click value a given
// units/upgrades/phd state could produce, at the most generous booster/crit
// rolls unconditionally assumed to have landed every time. Extracted so the
// earnings bound can evaluate it against both a pre- and a post-prestige
// state without two hand-copied blocks silently drifting apart.
//
// The Academic Career tree (`mods`) widens every part of it: per-unit and
// global production multipliers, the stronger per-PhD bonus, booster potency
// (and any booster the tree unlocked), click multiplier, synergy, a higher
// crit multiplier and the Lecture momentum cap. maxAutoIncome is the Teaching
// Assistants' passive click income per second — credited by the client's
// tick(), never through totalClicks, so it is bounded by time, not clicks.
function maxEconomy(
  state: {
    units: UnitSnapshot[];
    upgrades: string[];
    phdCount: number;
  },
  mods: CareerModifiers
): { maxTps: number; maxClickValue: number; maxAutoIncome: number } {
  const maxBaseTps = getCareerBaseTps(state.units, mods);
  const maxProdMultiplier =
    getCareerPhdProductionMultiplier(state.phdCount, mods) *
    getCareerProductionMultiplier(mods) *
    getMaxBoosterMultiplier("production", mods);
  const maxTps = maxBaseTps * maxProdMultiplier;

  const clickParams = {
    flatClickBonus: getFlatClickBonus(state.upgrades),
    clickMultiplier: getClickMultiplier(state.upgrades) * mods.clickMult,
    phdProductionMultiplier: maxProdMultiplier,
    tokensPerSecond: maxTps,
    clickSynergy: getCareerClickSynergy(getClickSynergy(state.upgrades), mods)
  };
  const maxClickValue =
    getClickValue({
      ...clickParams,
      boosterClickMultiplier: getMaxBoosterMultiplier("click", mods)
    }) *
    (MAX_CRIT_MULTIPLIER + mods.critMultAdd) *
    (1 + mods.momentumMax);
  // Auto-clicks never crit, carry no momentum and no click booster.
  const maxAutoIncome =
    mods.autoClickRate * getClickValue({ ...clickParams, boosterClickMultiplier: 1 });

  return { maxTps, maxClickValue, maxAutoIncome };
}

// An upper bound on the production any purchase plan within `budget` can
// reach on top of `start`, at a given cost multiplier, as unit counts. Within a
// type each further unit costs more for the same production, so the best plan
// — allowed to buy a fraction of its last unit — buys units in order of
// production per token, and no integer plan beats it. The bound is therefore
// the shortest such prefix whose cost EXCEEDS the budget (the fractional plan
// stops inside its last unit), or every unit up to the caps if the budget
// covers them all. Found by bisecting on the production-per-token threshold —
// a closed-form count per type, so the cost doesn't grow with the budget.
function bestPurchase(
  start: Map<string, number>,
  budget: number,
  costMultiplier: number,
  mods: CareerModifiers
): Map<string, number> {
  const spend = Math.min(Math.max(0, budget), Number.MAX_VALUE);
  const types = UNIT_DEFINITIONS.map((def) => {
    const prod = def.baseProduction * (mods.unitProductionMult[def.id] ?? 1);
    const first = Math.min(MAX_UNIT_OWNED, start.get(def.id) ?? 0);
    // The last index whose price is still a finite number.
    const finiteMax = Math.floor(
      Math.log(Number.MAX_VALUE / (def.baseCost * costMultiplier)) / Math.log(def.costGrowth)
    );
    return { def, prod, first, last: Math.min(MAX_UNIT_OWNED - 1, finiteMax) };
  });
  const ratioAt = (t: (typeof types)[number], n: number) =>
    t.prod / getUnitCost(t.def, n, costMultiplier);
  // How many units of one type have at least `threshold` production per token.
  const countAt = (t: (typeof types)[number], threshold: number) => {
    if (t.first > t.last) return 0;
    const estimate =
      Math.log(t.prod / (threshold * t.def.baseCost * costMultiplier)) /
      Math.log(t.def.costGrowth);
    let n = Math.max(t.first - 1, Math.min(t.last, Math.floor(estimate)));
    while (n >= t.first && ratioAt(t, n) < threshold) n--;
    while (n < t.last && ratioAt(t, n + 1) >= threshold) n++;
    return n + 1 - t.first;
  };
  const costAt = (threshold: number) =>
    types.reduce(
      (sum, t) => sum + getBulkCost(t.def, t.first, countAt(t, threshold), costMultiplier),
      0
    );
  const result = (threshold: number) =>
    new Map(types.map((t) => [t.def.id, t.first + countAt(t, threshold)]));

  // Everything up to the caps fits: nothing else bounds it.
  if (costAt(Number.MIN_VALUE) <= spend) return result(Number.MIN_VALUE);
  // `hi` buys a prefix that fits (none at all, above every type's next unit);
  // `lo` buys one that doesn't. Narrow them until they are adjacent.
  const bestNext = Math.max(...types.map((t) => (t.first <= t.last ? ratioAt(t, t.first) : 0)));
  let hi = Math.log(bestNext * 2);
  let lo = Math.log(Number.MIN_VALUE);
  for (let i = 0; i < 120 && hi - lo > 1e-12; i++) {
    const mid = (hi + lo) / 2;
    if (costAt(Math.exp(mid)) <= spend) hi = mid;
    else lo = mid;
  }
  return result(Math.exp(lo));
}

// The runs affordablePeakState walks through. Two are enough for the bound to
// hold for any number of prestiges: what a prestige keeps is never worth more
// than what was paid for it, so every later run's units stay within what the
// whole budget buys on top of the previous save's (a share of) units.
const PEAK_RUNS_EVALUATED = 1;

// The strongest state a prestiged interval could have passed through. With
// the Academic Career (kept units, a start fund, auto-buyers, a large PhD
// bonus) a whole run can start, peak and prestige between two saves: the
// previous save then shows the run's START and the incoming one the next
// run's start, and the run's peak economy — which produced its earnings — is
// in neither. Everything bought during the interval was paid for out of
// `budget` (what was held, plus what was earned, plus the start funds), so,
// run by run:
//   - the run in progress continues from the previous save's units and buys
//     at most `budget` worth on top, at their real prices;
//   - the next run restarts from what the tree keeps of that one
//     (keptUnitCount) and again buys at most `budget` worth (later runs need
//     no walk of their own — see PEAK_RUNS_EVALUATED);
//   - per unit type, the largest count any of those runs reaches;
//   - every upgrade the budget could pay for, plus those already owned;
//   - the larger PhD count of the two saves (held PhDs only change through a
//     prestige between saves, and they only grow there).
// The claimed earnings are part of the budget, but prices grow geometrically,
// so the economy this credits grows only with the logarithm of the claim: an
// inflated claim still can't fit inside its own bound.
function affordablePeakState(
  prev: PrevSaveSnapshot | null,
  incoming: IncomingSave,
  budget: number,
  runs: number,
  mods: CareerModifiers
): { units: UnitSnapshot[]; upgrades: string[]; phdCount: number } {
  const phdCount = Math.max(prev?.phdCount ?? 0, incoming.phdCount);
  const costMultiplier = getCareerUnitCostMultiplier(
    phdCount,
    mods,
    getMaxBoosterMultiplier("costReduction", mods)
  );
  const spend = Math.max(0, budget);
  let run = bestPurchase(unitMap(prev?.units ?? []), spend, costMultiplier, mods);
  const peak = new Map(run);
  for (let r = 0; r < Math.min(runs, PEAK_RUNS_EVALUATED); r++) {
    const kept = new Map(
      UNIT_DEFINITIONS.map((def) => [def.id, keptUnitCount(run.get(def.id)!, mods.keepUnitsBp)])
    );
    const next = bestPurchase(kept, spend, costMultiplier, mods);
    const settled = UNIT_DEFINITIONS.every((def) => next.get(def.id) === run.get(def.id));
    run = next;
    for (const [id, n] of run) peak.set(id, Math.max(peak.get(id)!, n));
    if (settled) break;
  }
  const incomingOwned = unitMap(incoming.units);
  const units = UNIT_DEFINITIONS.map((def) => ({
    unitId: def.id,
    owned: Math.max(incomingOwned.get(def.id) ?? 0, peak.get(def.id)!)
  }));
  const upgrades = new Set([...(prev?.upgrades ?? []), ...incoming.upgrades]);
  for (const def of UPGRADE_DEFINITIONS) {
    if (getCareerUpgradeCost(def.cost, mods) * costMultiplier <= budget) upgrades.add(def.id);
  }
  return { units, upgrades: [...upgrades], phdCount };
}

// The strongest production rate, auto income and click value an interval
// from `prev` to `incoming` could have run at — the economy step of the
// earnings bound below (see its comment for why a prestiged interval takes the
// best of three economies). Independent of the interval's length, so the
// grace-lead check (graceLeadNeeds) shares it.
function intervalEconomy(
  prev: PrevSaveSnapshot | null,
  incoming: IncomingSave,
  mods: CareerModifiers
): { maxTps: number; maxClickValue: number; maxAutoIncome: number } {
  const prevPhdCount = prev?.phdCount ?? 0;
  const prestiged = incoming.prestigeCount > (prev?.prestigeCount ?? 0);
  const deltaPrestige = Math.max(0, incoming.prestigeCount - (prev?.prestigeCount ?? 0));
  const deltaEarned = incoming.totalTokensEarned - (prev?.totalTokensEarned ?? 0);
  const postEconomy = maxEconomy(
    {
      units: incoming.units,
      upgrades: incoming.upgrades,
      phdCount: incoming.phdCount
    },
    mods
  );
  const peakBudget = (prev?.tokens ?? 0) + deltaEarned + mods.startingTokens * deltaPrestige;
  const economies = prestiged
    ? [
        postEconomy,
        maxEconomy(
          {
            units: prev?.units ?? [],
            upgrades: prev?.upgrades ?? [],
            phdCount: prevPhdCount
          },
          mods
        ),
        maxEconomy(affordablePeakState(prev, incoming, peakBudget, deltaPrestige, mods), mods)
      ]
    : [postEconomy];
  return {
    maxTps: Math.max(...economies.map((e) => e.maxTps)),
    maxClickValue: Math.max(...economies.map((e) => e.maxClickValue)),
    maxAutoIncome: Math.max(...economies.map((e) => e.maxAutoIncome))
  };
}

/**
 * How far past the wall clock (dtRealSecs, the server's interval WITHOUT any
 * grace) this save's claims reach, in seconds, per bound that scales with
 * time: the grace each one would need to pass. Negative = it would pass in a
 * shorter interval. The grace-lead ledger (services/graceLead.ts) charges the
 * largest of these to the save chain's one shared budget. Earnings: the
 * interval length at which the earnings bound below would just hold.
 */
export function graceLeadNeeds(
  prev: PrevSaveSnapshot,
  incoming: IncomingSave,
  dtRealSecs: number
): { elapsed: number; clicks: number; earnings: number } {
  const deltaClicks = incoming.totalClicks - prev.totalClicks;
  const deltaEarned = incoming.totalTokensEarned - prev.totalTokensEarned;
  const { maxTps, maxClickValue, maxAutoIncome } = intervalEconomy(prev, incoming, prev.career);
  const rate = maxTps + maxAutoIncome;
  const fromTime = deltaEarned / EARNED_ACCEPT_MARGIN - Math.max(0, deltaClicks) * maxClickValue;
  const earningsSecs =
    rate > 0 ? fromTime / rate : fromTime > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  return {
    elapsed: incoming.elapsedSeconds - prev.elapsedSeconds - dtRealSecs,
    clicks: deltaClicks / ENVELOPE_MAX_CPS - dtRealSecs,
    earnings: earningsSecs - dtRealSecs
  };
}

export function evaluateSaveEnvelope(
  prev: PrevSaveSnapshot | null,
  userCreatedAt: Date,
  now: Date,
  incoming: IncomingSave,
  // The clock grace this save may use: CLOCK_GRACE_SECS, or more when the
  // save chain's grace lead leaves room for it (see services/graceLead.ts) —
  // and the grace the earnings bound may use, which can be less.
  graceSecs: number = CLOCK_GRACE_SECS,
  earningsGraceSecs: number = graceSecs
): EnvelopeVerdict {
  const prevTokens = prev?.tokens ?? 0;
  const prevTotalTokensEarned = prev?.totalTokensEarned ?? 0;
  const prevTotalClicks = prev?.totalClicks ?? 0;
  const prevElapsedSeconds = prev?.elapsedSeconds ?? 0;
  const prevPhdCount = prev?.phdCount ?? 0;
  const prevPrestigeCount = prev?.prestigeCount ?? 0;
  const prevUnits = unitMap(prev?.units ?? []);
  const mods = prev?.career ?? emptyCareerModifiers();
  // A first-ever save is anchored to whichever is longer: the account's age,
  // or the playtime it claims (a guest's, from before the account existed) up
  // to FIRST_SAVE_PLAYTIME_CREDIT_SECS. Every later save uses the wall clock.
  const anchor =
    prev?.savedAt ??
    new Date(
      Math.min(
        userCreatedAt.getTime(),
        now.getTime() - Math.min(incoming.elapsedSeconds, FIRST_SAVE_PLAYTIME_CREDIT_SECS) * 1000
      )
    );

  // --- Hard monotonicity — these can never legitimately decrease. ---------
  if (
    incoming.totalTokensEarned < prevTotalTokensEarned ||
    incoming.totalClicks < prevTotalClicks ||
    incoming.elapsedSeconds < prevElapsedSeconds ||
    incoming.phdCount < prevPhdCount ||
    incoming.prestigeCount < prevPrestigeCount
  ) {
    return {
      outcome: "reject",
      reason: "monotonicity_violation",
      detail: {
        prev: {
          totalTokensEarned: prevTotalTokensEarned,
          totalClicks: prevTotalClicks,
          elapsedSeconds: prevElapsedSeconds,
          phdCount: prevPhdCount,
          prestigeCount: prevPrestigeCount
        },
        incoming: {
          totalTokensEarned: incoming.totalTokensEarned,
          totalClicks: incoming.totalClicks,
          elapsedSeconds: incoming.elapsedSeconds,
          phdCount: incoming.phdCount,
          prestigeCount: incoming.prestigeCount
        }
      }
    };
  }

  const wallSecs = Math.max(0, (now.getTime() - anchor.getTime()) / 1000);
  const dtSecs = wallSecs + graceSecs;

  const clamped: EnvelopeClamped = {};
  const reasons: string[] = [];
  const detail: Record<string, unknown> = { dtSecs };
  // True once ANY clamped dimension below was materially over its bound —
  // see SOFT_CLAMP_MATERIAL_RATIO's own comment. Determines whether the
  // overall verdict's clamp counts toward recordSoftClamp's strike pattern
  // at all.
  let clampIsMaterial = false;

  // --- elapsed time: no offline progress exists (the tick loop only runs
  //     while the tab is mounted), so Δelapsed can never exceed real
  //     wall-clock time between saves. ---------------------------------
  const deltaElapsed = incoming.elapsedSeconds - prevElapsedSeconds;
  const elapsedCheck = checkBound(deltaElapsed, dtSecs);
  detail["elapsed"] = { deltaElapsed, bound: dtSecs, outcome: elapsedCheck.outcome };
  if (elapsedCheck.outcome === "reject") {
    return { outcome: "reject", reason: "elapsed_exceeds_wallclock", detail };
  }
  if (elapsedCheck.outcome === "clamp") {
    clamped.elapsedSeconds = prevElapsedSeconds + elapsedCheck.to;
    reasons.push("elapsed_exceeds_wallclock");
    clampIsMaterial = clampIsMaterial || elapsedCheck.material;
  }

  // --- clicks: bounded by a generous burst CPS over the same wall-clock dt. ---
  const deltaClicks = incoming.totalClicks - prevTotalClicks;
  const clickBound = ENVELOPE_MAX_CPS * dtSecs;
  const clickCheck = checkBound(deltaClicks, clickBound);
  detail["clicks"] = { deltaClicks, bound: clickBound, outcome: clickCheck.outcome };
  if (clickCheck.outcome === "reject") {
    return { outcome: "reject", reason: "clicks_exceed_human_rate", detail };
  }
  let effectiveDeltaClicks = deltaClicks;
  if (clickCheck.outcome === "clamp") {
    effectiveDeltaClicks = clickCheck.to;
    clamped.totalClicks = prevTotalClicks + effectiveDeltaClicks;
    reasons.push("clicks_exceed_human_rate");
    clampIsMaterial = clampIsMaterial || clickCheck.material;
  }

  // A prestige within this interval resets owned units/upgrades to 0 partway
  // through — computed here, before the earnings bound, because that bound
  // needs to know whether it's looking at one economy or two spliced
  // together (see below). Reused by the spend section further down.
  const prestiged = incoming.prestigeCount > prevPrestigeCount;

  // --- earnings: bounded by the strongest possible production AND click
  //     value some account state could produce over this interval, at the
  //     most generous booster/crit rolls unconditionally assumed to have
  //     landed every time.
  //
  //     A prestige inside the interval splits it across TWO economies: any
  //     tokens earned before the reset were produced by the PRE-prestige
  //     unit/upgrade/phd state, but `incoming` only reports the POST-reset
  //     (near-empty) one. Bounding the whole interval by the post-reset
  //     rate alone makes every legitimate "prestige, then autosave" a
  //     guaranteed reject — the bound collapses toward 0 exactly when
  //     deltaClicks is also 0 (a real production incident: deltaEarned
  //     242184.99 against a computed bound of exactly 0). Allowing the
  //     full interval at EITHER economy's rate is a strictly valid upper
  //     bound (the true earnings are produced by some split of the
  //     interval between the two rates, and letting the whole interval run
  //     at whichever rate is larger only ever loosens the bound, never
  //     tightens it) and stays well inside what a genuine client could
  //     have produced.
  //
  //     Neither end of a prestiged interval need be its peak, though: a run
  //     can start AND finish between two saves (a real production incident,
  //     2026-10-20 — the leading player's ~11 s runs, 8.1e11 earned against
  //     a bound of 2.1e11 built from two run-start states, rejected and
  //     struck in a loop). The third economy, affordablePeakState, is the
  //     strongest one the interval's own budget could have bought. ---------
  const deltaEarned = incoming.totalTokensEarned - prevTotalTokensEarned;
  const { maxTps, maxClickValue, maxAutoIncome } = intervalEconomy(prev, incoming, mods);

  const earnedBound =
    ((maxTps + maxAutoIncome) * (wallSecs + earningsGraceSecs) +
      effectiveDeltaClicks * maxClickValue) *
    EARNED_ACCEPT_MARGIN;
  const earnedCheck = checkBound(deltaEarned, earnedBound);
  detail["earned"] = { deltaEarned, bound: earnedBound, outcome: earnedCheck.outcome, prestiged };
  if (earnedCheck.outcome === "reject") {
    return { outcome: "reject", reason: "earnings_exceed_max_possible", detail };
  }
  let effectiveTotalTokensEarned = incoming.totalTokensEarned;
  let effectiveDeltaEarned = deltaEarned;
  if (earnedCheck.outcome === "clamp") {
    effectiveDeltaEarned = earnedCheck.to;
    effectiveTotalTokensEarned = prevTotalTokensEarned + effectiveDeltaEarned;
    clamped.totalTokensEarned = effectiveTotalTokensEarned;
    reasons.push("earnings_exceed_max_possible");
    clampIsMaterial = clampIsMaterial || earnedCheck.material;
  }

  // --- spend: leftover tokens can't exceed what remains after paying at
  //     least the cheapest possible price for every newly acquired unit and
  //     upgrade — this is what catches "free units" (a purchase asserted
  //     without a matching token deduction). A prestige within this interval
  //     resets owned units/upgrades to 0, so `before` is taken as 0 in that
  //     case — a strictly lower (still valid, more generous) bound on spend,
  //     since the true pre-reset owned counts are no longer relevant.
  //
  //     The Academic Career tree changes what a prestige resets: a share of
  //     every unit (keepUnitsBp) and whole upgrade families survive it for
  //     free, and each new run starts with a token fund. Kept units count as
  //     `before` = floor(prevOwned x keep) — a valid lower bound for any
  //     number of prestiges in the interval, since units are never sold, a
  //     unit's price only rises with the count, and what's kept never exceeds
  //     that share of what was owned at the prestige. -----------------------
  const bestCostMultiplier = getCareerUnitCostMultiplier(
    incoming.phdCount,
    mods,
    getMaxBoosterMultiplier("costReduction", mods)
  );
  let minSpend = 0;
  for (const u of incoming.units) {
    const prevOwned = prevUnits.get(u.unitId) ?? 0;
    const before = prestiged ? keptUnitCount(prevOwned, mods.keepUnitsBp) : prevOwned;
    const delta = u.owned - before;
    if (delta <= 0) continue;
    const def = getUnitDefinition(u.unitId);
    if (!def) continue;
    minSpend += getBulkCost(def, before, delta, bestCostMultiplier);
  }
  const prevUpgradeSet = new Set(
    prestiged
      ? (prev?.upgrades ?? []).filter((id) => isKeptUpgrade(id, mods))
      : (prev?.upgrades ?? [])
  );
  for (const upgradeId of incoming.upgrades) {
    if (prevUpgradeSet.has(upgradeId)) continue;
    const def = getUpgradeDefinition(upgradeId);
    if (def) minSpend += getCareerUpgradeCost(def.cost, mods) * bestCostMultiplier;
  }

  // The claimed purchase itself must have been affordable, independent of
  // whatever `tokens` balance is reported: the check below (comparing
  // incoming.tokens against maxTokensAfter) only bounds the LEFTOVER
  // balance, and trivially passes if a forged save simply reports tokens: 0
  // regardless of how large minSpend actually is — "I spent everything" is
  // not by itself proof the units/upgrades were ever affordable. There is no
  // sensible way to "partially clamp" an owned-units claim (which unit would
  // give some back?), so this is a straight reject beyond a tiny float-noise
  // epsilon, not a two-tier checkBound.
  // The start fund: one per prestige in the interval, but never more than
  // the earnings could have paid for (each prestige needs a run of at least
  // PHD_TOKEN_SCALE tokens). That cap matters because prestigeCount is only
  // bounded further below — an uncapped fund x a forged prestigeCount would
  // otherwise buy unlimited free units.
  //
  // Only prestiges that each gained a PhD count: an honest one always does,
  // and nothing else can lower phdCount between two saves (every other PhD
  // change is server-written and already in `prev`) — so a bare
  // prestigeCount bump earns no fund.
  const deltaPrestige = Math.max(0, incoming.prestigeCount - prevPrestigeCount);
  const startFunds = Math.min(
    deltaPrestige,
    Math.max(0, incoming.phdCount - prevPhdCount),
    Math.floor(Math.max(0, effectiveDeltaEarned) / PHD_TOKEN_SCALE) + 1
  );
  const availableBudget = prevTokens + effectiveDeltaEarned + mods.startingTokens * startFunds;
  detail["spendBudget"] = { minSpend, availableBudget };
  if (minSpend > availableBudget + floatTolerance(minSpend, availableBudget)) {
    return { outcome: "reject", reason: "spend_exceeds_available_budget", detail };
  }

  // The leftover is a difference of two large numbers, so its float error is
  // proportional to THEM, not to the (possibly tiny) leftover: a client that
  // saved up ~1e14 and spent nearly all of it carries tens of tokens of drift.
  // checkBound's own tolerance only scales with the leftover, so the spend's
  // tolerance is added to the bound — a cheat gains at most 1e-9 of a spend.
  const maxTokensAfter =
    availableBudget - minSpend + (minSpend > 0 ? floatTolerance(availableBudget, minSpend) : 0);
  const tokensCheck = checkBound(incoming.tokens, maxTokensAfter);
  detail["spend"] = {
    minSpend,
    maxTokensAfter,
    tokens: incoming.tokens,
    outcome: tokensCheck.outcome
  };
  if (tokensCheck.outcome === "reject") {
    return { outcome: "reject", reason: "tokens_exceed_after_required_spend", detail };
  }
  if (tokensCheck.outcome === "clamp") {
    clamped.tokens = tokensCheck.to;
    reasons.push("tokens_exceed_after_required_spend");
    clampIsMaterial = clampIsMaterial || tokensCheck.material;
  }

  // --- prestige count: each prestige requires a run of at least
  //     PHD_TOKEN_SCALE tokens (the minimum to gain even 1 PhD), and that
  //     run's tokens are folded into totalTokensEarned permanently — so the
  //     number of prestiges is fundamentally bounded by lifetime earnings.
  //     This must be checked BEFORE the PhD bound below, since an
  //     unconstrained prestigeCount would otherwise let that bound's own
  //     sqrt(prestigeCount * earned) term be inflated arbitrarily. ---------
  const prestigeBound = effectiveTotalTokensEarned / PHD_TOKEN_SCALE + PRESTIGE_COUNT_SLACK;
  const prestigeCheck = checkBound(incoming.prestigeCount, prestigeBound);
  detail["prestigeCount"] = {
    prestigeCount: incoming.prestigeCount,
    bound: prestigeBound,
    outcome: prestigeCheck.outcome
  };
  if (prestigeCheck.outcome === "reject") {
    return { outcome: "reject", reason: "prestige_count_exceeds_max_possible", detail };
  }
  // Int column — floor a clamped value down to a whole prestige count.
  let effectivePrestigeCount = incoming.prestigeCount;
  if (prestigeCheck.outcome === "clamp") {
    effectivePrestigeCount = Math.floor(prestigeCheck.to);
    clamped.prestigeCount = effectivePrestigeCount;
    reasons.push("prestige_count_exceeds_max_possible");
    clampIsMaterial = clampIsMaterial || prestigeCheck.material;
  }

  // --- PhD count: splitting a fixed token budget across many minimal-sized
  //     prestige runs maximizes total PhDs gained (sqrt is concave), so the
  //     worst case for a given (prestigeCount, totalTokensEarned) pair is
  //     bounded by Cauchy-Schwarz: Σsqrt(r_i/S) <= sqrt(n * ΣR_i / S). Uses
  //     the already-clamped prestigeCount, the same "feed the more
  //     restrictive, already-adjusted value forward" pattern the click/
  //     earned bounds above use. ------------------------------------------
  //     The upgrader moves PhDs without a prestige, so the bound is shifted by
  //     the server-recorded signed net of every spin: PhDs held = PhDs earned
  //     through prestige (<= the Cauchy bound) + upgraderNet. A net loser's
  //     bound shrinks accordingly, and it is floored at 0 so a forged huge
  //     negative net can never produce a negative clamp target. ------------
  //     The Academic Career moves PhDs too: each prestige's gain is scaled
  //     by the tree's PhD-gain bonus (at most the current one — earlier-window
  //     nodes are permanent, and a refundable node is never in effect at a
  //     prestige), and PhDs sunk into the tree are no longer held. -----------
  const phdBound = Math.max(
    0,
    (1 + mods.phdGainBp / 10000) *
      Math.sqrt(
        (Math.max(0, effectivePrestigeCount) * Math.max(0, effectiveTotalTokensEarned)) /
          PHD_TOKEN_SCALE
      ) +
      PHD_BOUND_SLACK +
      (prev?.upgraderNet ?? 0) -
      (prev?.phdInvested ?? 0)
  );
  const phdCheck = checkBound(incoming.phdCount, phdBound);
  detail["phd"] = { phdCount: incoming.phdCount, bound: phdBound, outcome: phdCheck.outcome };
  if (phdCheck.outcome === "reject") {
    return { outcome: "reject", reason: "phd_exceeds_max_possible", detail };
  }
  if (phdCheck.outcome === "clamp") {
    clamped.phdCount = Math.floor(phdCheck.to);
    reasons.push("phd_exceeds_max_possible");
    clampIsMaterial = clampIsMaterial || phdCheck.material;
  }

  if (reasons.length > 0) {
    return { outcome: "clamp", clamped, reasons, detail, material: clampIsMaterial };
  }
  return { outcome: "accept" };
}
