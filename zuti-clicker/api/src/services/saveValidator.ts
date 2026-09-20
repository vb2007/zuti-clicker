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
  PRESTIGE_COUNT_SLACK
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
const FLOOR = 1e-6;
function checkBound(
  actual: number,
  rawBound: number
): { outcome: "ok" } | { outcome: "clamp"; to: number } | { outcome: "reject" } {
  const bound = Math.max(0, rawBound);
  if (actual <= bound + FLOOR) return { outcome: "ok" };
  if (actual <= bound * REJECT_MULTIPLIER + FLOOR) return { outcome: "clamp", to: bound };
  return { outcome: "reject" };
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

  // --- earnings: bounded by the strongest possible production AND click
  //     value this account's OWN after-state (units/upgrades/phd) could
  //     produce, over the same interval, at the most generous booster/crit
  //     rolls unconditionally assumed to have landed every time. ---------
  const maxBaseTps = incoming.units.reduce((sum, u) => {
    const def = getUnitDefinition(u.unitId);
    return def ? sum + u.owned * def.baseProduction : sum;
  }, 0);
  const maxProdMultiplier = getProductionMultiplier(incoming.phdCount) * MAX_PRODUCTION_BOOSTER_MULTIPLIER;
  const maxTps = maxBaseTps * maxProdMultiplier;

  const flatClickBonus = getFlatClickBonus(incoming.upgrades);
  const clickMultiplier = getClickMultiplier(incoming.upgrades);
  const clickSynergy = getClickSynergy(incoming.upgrades);
  const maxClickValue =
    getClickValue({
      flatClickBonus,
      clickMultiplier,
      phdProductionMultiplier: maxProdMultiplier,
      tokensPerSecond: maxTps,
      clickSynergy,
      boosterClickMultiplier: MAX_CLICK_BOOSTER_MULTIPLIER
    }) * MAX_CRIT_MULTIPLIER;

  const deltaEarned = incoming.totalTokensEarned - prevTotalTokensEarned;
  const earnedBound = (maxTps * dtSecs + effectiveDeltaClicks * maxClickValue) * EARNED_ACCEPT_MARGIN;
  const earnedCheck = checkBound(deltaEarned, earnedBound);
  detail["earned"] = { deltaEarned, bound: earnedBound, outcome: earnedCheck.outcome };
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
  const prestiged = incoming.prestigeCount > prevPrestigeCount;
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

  const maxTokensAfter = prevTokens + effectiveDeltaEarned - minSpend;
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
  detail["prestigeCount"] = { prestigeCount: incoming.prestigeCount, bound: prestigeBound };
  if (incoming.prestigeCount > prestigeBound * REJECT_MULTIPLIER) {
    return { outcome: "reject", reason: "prestige_count_exceeds_max_possible", detail };
  }

  // --- PhD count: splitting a fixed token budget across many minimal-sized
  //     prestige runs maximizes total PhDs gained (sqrt is concave), so the
  //     worst case for a given (prestigeCount, totalTokensEarned) pair is
  //     bounded by Cauchy-Schwarz: Σsqrt(r_i/S) <= sqrt(n * ΣR_i / S). -----
  const phdBound =
    Math.sqrt(
      (Math.max(0, incoming.prestigeCount) * Math.max(0, effectiveTotalTokensEarned)) / PHD_TOKEN_SCALE
    ) + PHD_BOUND_SLACK;
  detail["phd"] = { phdCount: incoming.phdCount, bound: phdBound };
  if (incoming.phdCount > phdBound * REJECT_MULTIPLIER) {
    return { outcome: "reject", reason: "phd_exceeds_max_possible", detail };
  }

  if (reasons.length > 0) {
    return { outcome: "clamp", clamped, reasons, detail };
  }
  return { outcome: "accept" };
}
