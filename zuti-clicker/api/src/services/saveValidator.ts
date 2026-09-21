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
  MAX_PRODUCTION_BOOSTER_MULTIPLIER,
  MAX_CLICK_BOOSTER_MULTIPLIER,
  MIN_COST_BOOSTER_MULTIPLIER
} from "../constants/gameBalance";
import {
  getBulkCost,
  getProductionMultiplier,
  getCostMultiplier,
  getFlatClickBonus,
  getClickMultiplier,
  getClickSynergy,
  getClickValue
} from "./economy";
import {
  CLOCK_GRACE_SECS,
  ENVELOPE_MAX_CPS,
  REJECT_MULTIPLIER,
  EARNED_ACCEPT_MARGIN,
  PHD_BOUND_SLACK,
  PRESTIGE_COUNT_SLACK,
  floatTolerance
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
  savedAt: Date;
  units: UnitSnapshot[];
  upgrades: string[];
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
    }
  | { outcome: "reject"; reason: string; detail: Record<string, unknown> };

function unitMap(units: UnitSnapshot[]): Map<string, number> {
  return new Map(units.map((u) => [u.unitId, u.owned]));
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
): { outcome: "ok" } | { outcome: "clamp"; to: number } | { outcome: "reject" } {
  const bound = Math.max(0, rawBound);
  const tolerance = floatTolerance(actual, bound);
  if (actual <= bound + tolerance) return { outcome: "ok" };
  const rejectThreshold = Math.max(bound * REJECT_MULTIPLIER, bound + REJECT_ABS_SLACK);
  if (actual <= rejectThreshold + tolerance) return { outcome: "clamp", to: bound };
  return { outcome: "reject" };
}

// The strongest possible production rate AND click value a given
// units/upgrades/phd state could produce, at the most generous booster/crit
// rolls unconditionally assumed to have landed every time. Extracted so the
// earnings bound can evaluate it against both a pre- and a post-prestige
// state without two hand-copied blocks silently drifting apart.
function maxEconomy(state: {
  units: UnitSnapshot[];
  upgrades: string[];
  phdCount: number;
}): { maxTps: number; maxClickValue: number } {
  const maxBaseTps = state.units.reduce((sum, u) => {
    const def = getUnitDefinition(u.unitId);
    return def ? sum + u.owned * def.baseProduction : sum;
  }, 0);
  const maxProdMultiplier = getProductionMultiplier(state.phdCount) * MAX_PRODUCTION_BOOSTER_MULTIPLIER;
  const maxTps = maxBaseTps * maxProdMultiplier;

  const flatClickBonus = getFlatClickBonus(state.upgrades);
  const clickMultiplier = getClickMultiplier(state.upgrades);
  const clickSynergy = getClickSynergy(state.upgrades);
  const maxClickValue =
    getClickValue({
      flatClickBonus,
      clickMultiplier,
      phdProductionMultiplier: maxProdMultiplier,
      tokensPerSecond: maxTps,
      clickSynergy,
      boosterClickMultiplier: MAX_CLICK_BOOSTER_MULTIPLIER
    }) * MAX_CRIT_MULTIPLIER;

  return { maxTps, maxClickValue };
}

export function evaluateSaveEnvelope(
  prev: PrevSaveSnapshot | null,
  userCreatedAt: Date,
  now: Date,
  incoming: IncomingSave
): EnvelopeVerdict {
  const prevTokens = prev?.tokens ?? 0;
  const prevTotalTokensEarned = prev?.totalTokensEarned ?? 0;
  const prevTotalClicks = prev?.totalClicks ?? 0;
  const prevElapsedSeconds = prev?.elapsedSeconds ?? 0;
  const prevPhdCount = prev?.phdCount ?? 0;
  const prevPrestigeCount = prev?.prestigeCount ?? 0;
  const prevUnits = unitMap(prev?.units ?? []);
  const anchor = prev?.savedAt ?? userCreatedAt;

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

  const dtSecs = Math.max(0, (now.getTime() - anchor.getTime()) / 1000) + CLOCK_GRACE_SECS;

  const clamped: EnvelopeClamped = {};
  const reasons: string[] = [];
  const detail: Record<string, unknown> = { dtSecs };

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
  //     have produced. ------------------------------------------------------
  const postEconomy = maxEconomy({
    units: incoming.units,
    upgrades: incoming.upgrades,
    phdCount: incoming.phdCount
  });
  const preEconomy = prestiged
    ? maxEconomy({
        units: prev?.units ?? [],
        upgrades: prev?.upgrades ?? [],
        phdCount: prevPhdCount
      })
    : null;
  const maxTps = preEconomy ? Math.max(preEconomy.maxTps, postEconomy.maxTps) : postEconomy.maxTps;
  const maxClickValue = preEconomy
    ? Math.max(preEconomy.maxClickValue, postEconomy.maxClickValue)
    : postEconomy.maxClickValue;

  const deltaEarned = incoming.totalTokensEarned - prevTotalTokensEarned;
  const earnedBound = (maxTps * dtSecs + effectiveDeltaClicks * maxClickValue) * EARNED_ACCEPT_MARGIN;
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
  }

  // --- spend: leftover tokens can't exceed what remains after paying at
  //     least the cheapest possible price for every newly acquired unit and
  //     upgrade — this is what catches "free units" (a purchase asserted
  //     without a matching token deduction). A prestige within this interval
  //     resets owned units/upgrades to 0, so `before` is taken as 0 in that
  //     case — a strictly lower (still valid, more generous) bound on spend,
  //     since the true pre-reset owned counts are no longer relevant. ------
  const bestCostMultiplier = getCostMultiplier(incoming.phdCount) * MIN_COST_BOOSTER_MULTIPLIER;
  let minSpend = 0;
  for (const u of incoming.units) {
    const before = prestiged ? 0 : (prevUnits.get(u.unitId) ?? 0);
    const delta = u.owned - before;
    if (delta <= 0) continue;
    const def = getUnitDefinition(u.unitId);
    if (!def) continue;
    minSpend += getBulkCost(def, before, delta, bestCostMultiplier);
  }
  const prevUpgradeSet = new Set(prestiged ? [] : (prev?.upgrades ?? []));
  for (const upgradeId of incoming.upgrades) {
    if (prevUpgradeSet.has(upgradeId)) continue;
    const def = getUpgradeDefinition(upgradeId);
    if (def) minSpend += def.cost * bestCostMultiplier;
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
  const availableBudget = prevTokens + effectiveDeltaEarned;
  detail["spendBudget"] = { minSpend, availableBudget };
  if (minSpend > availableBudget + floatTolerance(minSpend, availableBudget)) {
    return { outcome: "reject", reason: "spend_exceeds_available_budget", detail };
  }

  const maxTokensAfter = availableBudget - minSpend;
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
  }

  // --- PhD count: splitting a fixed token budget across many minimal-sized
  //     prestige runs maximizes total PhDs gained (sqrt is concave), so the
  //     worst case for a given (prestigeCount, totalTokensEarned) pair is
  //     bounded by Cauchy-Schwarz: Σsqrt(r_i/S) <= sqrt(n * ΣR_i / S). Uses
  //     the already-clamped prestigeCount, the same "feed the more
  //     restrictive, already-adjusted value forward" pattern the click/
  //     earned bounds above use. ------------------------------------------
  const phdBound =
    Math.sqrt(
      (Math.max(0, effectivePrestigeCount) * Math.max(0, effectiveTotalTokensEarned)) / PHD_TOKEN_SCALE
    ) + PHD_BOUND_SLACK;
  const phdCheck = checkBound(incoming.phdCount, phdBound);
  detail["phd"] = { phdCount: incoming.phdCount, bound: phdBound, outcome: phdCheck.outcome };
  if (phdCheck.outcome === "reject") {
    return { outcome: "reject", reason: "phd_exceeds_max_possible", detail };
  }
  if (phdCheck.outcome === "clamp") {
    clamped.phdCount = Math.floor(phdCheck.to);
    reasons.push("phd_exceeds_max_possible");
  }

  if (reasons.length > 0) {
    return { outcome: "clamp", clamped, reasons, detail };
  }
  return { outcome: "accept" };
}
