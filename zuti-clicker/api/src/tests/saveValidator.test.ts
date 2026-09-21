import { describe, it, expect } from "@jest/globals";
import { evaluateSaveEnvelope, type PrevSaveSnapshot, type IncomingSave } from "../services/saveValidator.js";
import { getClickValue } from "../services/economy.js";
import {
  BASE_TOKENS_PER_CLICK,
  MAX_CRIT_MULTIPLIER,
  MAX_PRODUCTION_BOOSTER_MULTIPLIER,
  MAX_CLICK_BOOSTER_MULTIPLIER,
  PHD_TOKEN_SCALE
} from "../constants/gameBalance.js";
import { EARNED_ACCEPT_MARGIN, REJECT_MULTIPLIER, CLOCK_GRACE_SECS } from "../constants/antiCheat.js";

// Pure unit tests — no live server or database, unlike most of src/tests/.
// The HTTP-level wiring (save.ts calling this, clamping the actual response,
// rejecting with 409) is covered separately in save.test.ts's "plausibility
// envelope" section; this file is where the envelope's own math is proved,
// case by case, fast and deterministically.

const NOW = new Date("2026-01-01T00:00:10.000Z");
const USER_CREATED_AT = new Date("2025-01-01T00:00:00.000Z");

function freshSave(overrides: Partial<IncomingSave> = {}): IncomingSave {
  return {
    tokens: 0,
    totalTokensEarned: 0,
    totalClicks: 0,
    elapsedSeconds: 0,
    phdCount: 0,
    prestigeCount: 0,
    units: [],
    upgrades: [],
    ...overrides
  };
}

// The max value a single click could be worth with zero owned units (so
// production is 0 and only the flat base + max booster/crit applies) —
// derived from the real formulas, never hardcoded, so this test can't drift
// from the envelope's own math.
const MAX_CLICK_VALUE_NO_UNITS =
  getClickValue({
    flatClickBonus: 0,
    clickMultiplier: 1,
    phdProductionMultiplier: MAX_PRODUCTION_BOOSTER_MULTIPLIER, // getProductionMultiplier(0) === 1
    tokensPerSecond: 0,
    clickSynergy: 0,
    boosterClickMultiplier: MAX_CLICK_BOOSTER_MULTIPLIER
  }) * MAX_CRIT_MULTIPLIER;

describe("evaluateSaveEnvelope — first-ever save (prev = null)", () => {
  it("accepts a modest, clearly-achievable save", () => {
    const verdict = evaluateSaveEnvelope(
      null,
      USER_CREATED_AT,
      NOW,
      freshSave({ tokens: 5, totalTokensEarned: 5, totalClicks: 3, elapsedSeconds: 2 })
    );
    expect(verdict.outcome).toBe("accept");
  });

  it("rejects totalTokensEarned grossly beyond what any click/production could produce", () => {
    const verdict = evaluateSaveEnvelope(
      null,
      USER_CREATED_AT,
      NOW,
      freshSave({ tokens: 100_000, totalTokensEarned: 100_000, totalClicks: 1, elapsedSeconds: 1 })
    );
    expect(verdict.outcome).toBe("reject");
    if (verdict.outcome === "reject") expect(verdict.reason).toBe("earnings_exceed_max_possible");
  });

  it("clamps totalTokensEarned and tokens down to the earn bound when between 1x and 2x over", () => {
    const bound = 1 * MAX_CLICK_VALUE_NO_UNITS * EARNED_ACCEPT_MARGIN;
    const submitted = bound * 1.4; // within the clamp band, not the reject band
    const verdict = evaluateSaveEnvelope(
      null,
      USER_CREATED_AT,
      NOW,
      freshSave({ tokens: submitted, totalTokensEarned: submitted, totalClicks: 1, elapsedSeconds: 1 })
    );
    expect(verdict.outcome).toBe("clamp");
    if (verdict.outcome === "clamp") {
      expect(verdict.clamped.totalTokensEarned).toBeCloseTo(bound, 6);
      // No units/upgrades were bought, so minSpend is 0 — tokens clamps to
      // exactly the same bound as totalTokensEarned.
      expect(verdict.clamped.tokens).toBeCloseTo(bound, 6);
      expect(verdict.reasons).toContain("earnings_exceed_max_possible");
      expect(verdict.reasons).toContain("tokens_exceed_after_required_spend");
    }
  });

  it("rejects when the submitted value is more than REJECT_MULTIPLIER times the bound", () => {
    const bound = 1 * MAX_CLICK_VALUE_NO_UNITS * EARNED_ACCEPT_MARGIN;
    const verdict = evaluateSaveEnvelope(
      null,
      USER_CREATED_AT,
      NOW,
      freshSave({
        tokens: bound * REJECT_MULTIPLIER + 1,
        totalTokensEarned: bound * REJECT_MULTIPLIER + 1,
        totalClicks: 1,
        elapsedSeconds: 1
      })
    );
    expect(verdict.outcome).toBe("reject");
  });

  it("rejects clicks exceeding the human-rate envelope", () => {
    // dt = (NOW - userCreatedAt)/1000 + CLOCK_GRACE_SECS — huge here since
    // USER_CREATED_AT is a year before NOW, so this asserts against an
    // absurd click count no dt could cover, not a tight boundary.
    const verdict = evaluateSaveEnvelope(
      null,
      USER_CREATED_AT,
      NOW,
      freshSave({ totalClicks: Number.MAX_SAFE_INTEGER, elapsedSeconds: 1 })
    );
    expect(verdict.outcome).toBe("reject");
    if (verdict.outcome === "reject") expect(verdict.reason).toBe("clicks_exceed_human_rate");
  });

  it("rejects elapsedSeconds exceeding real wall-clock time", () => {
    const verdict = evaluateSaveEnvelope(null, USER_CREATED_AT, NOW, freshSave({ elapsedSeconds: 1e12 }));
    expect(verdict.outcome).toBe("reject");
    if (verdict.outcome === "reject") expect(verdict.reason).toBe("elapsed_exceeds_wallclock");
  });

  it("accepts elapsedSeconds right at the CLOCK_GRACE_SECS floor with zero real time elapsed", () => {
    const sameInstant = USER_CREATED_AT;
    const verdict = evaluateSaveEnvelope(
      null,
      sameInstant,
      sameInstant,
      freshSave({ elapsedSeconds: CLOCK_GRACE_SECS - 0.01 })
    );
    expect(verdict.outcome).toBe("accept");
  });
});

describe("evaluateSaveEnvelope — monotonicity", () => {
  // totalTokensEarned is large enough that phdCount: 2 / prestigeCount: 1 are
  // plausible under the Cauchy-Schwarz PhD bound (see saveValidator.ts) —
  // a smaller value here would make the fixture itself implausible and any
  // "unchanged, resync" case would (correctly) get clamped rather than
  // accepted, which is not what this describe block is testing.
  const prev: PrevSaveSnapshot = {
    tokens: 100,
    totalTokensEarned: 3_000_000,
    totalClicks: 50,
    elapsedSeconds: 500,
    phdCount: 2,
    prestigeCount: 1,
    savedAt: new Date(NOW.getTime() - 5000),
    units: [{ unitId: "alpha", owned: 5 }],
    upgrades: ["chalk"]
  };

  it.each([
    ["totalTokensEarned", { totalTokensEarned: 999 }],
    ["totalClicks", { totalClicks: 49 }],
    ["elapsedSeconds", { elapsedSeconds: 499 }],
    ["phdCount", { phdCount: 1 }],
    ["prestigeCount", { prestigeCount: 0 }]
  ])("rejects a decrease in %s", (_field, overrides) => {
    const verdict = evaluateSaveEnvelope(
      prev,
      USER_CREATED_AT,
      NOW,
      freshSave({
        tokens: prev.tokens,
        totalTokensEarned: prev.totalTokensEarned,
        totalClicks: prev.totalClicks,
        elapsedSeconds: prev.elapsedSeconds,
        phdCount: prev.phdCount,
        prestigeCount: prev.prestigeCount,
        units: prev.units,
        upgrades: prev.upgrades,
        ...overrides
      })
    );
    expect(verdict.outcome).toBe("reject");
    if (verdict.outcome === "reject") expect(verdict.reason).toBe("monotonicity_violation");
  });

  it("accepts identical values (no progress, e.g. an idle guest-style resync)", () => {
    const verdict = evaluateSaveEnvelope(
      prev,
      USER_CREATED_AT,
      NOW,
      freshSave({
        tokens: prev.tokens,
        totalTokensEarned: prev.totalTokensEarned,
        totalClicks: prev.totalClicks,
        elapsedSeconds: prev.elapsedSeconds,
        phdCount: prev.phdCount,
        prestigeCount: prev.prestigeCount,
        units: prev.units,
        upgrades: prev.upgrades
      })
    );
    expect(verdict.outcome).toBe("accept");
  });
});

describe("evaluateSaveEnvelope — earnings bound across a prestige", () => {
  // Regression, literal production incident: a real logged-in player was
  // struck (envelope_reject / earnings_exceed_max_possible) for prestiging
  // and then autosaving in the same interval. incoming.units is the
  // POST-reset (empty) state, but the deltaEarned reported was produced by
  // the PRE-reset economy during the run that led up to the prestige — the
  // old bound used only the post-reset rate, which is exactly 0 when
  // deltaClicks is also 0 (no clicks were needed to trigger the prestige
  // button itself). Every field below matches the incident's actual
  // AntiCheatEvent row (dtSecs 16.709, deltaClicks 0, deltaEarned
  // 242184.99000047147, click bound 751.905, elapsed bound 16.709).
  it("regression: does not reject a prestige-interval save bounded only by the pre-reset economy", () => {
    const prev: PrevSaveSnapshot = {
      tokens: 0,
      totalTokensEarned: 50_000_000,
      totalClicks: 10_000,
      elapsedSeconds: 50_000,
      phdCount: 3,
      prestigeCount: 12,
      savedAt: new Date(NOW.getTime() - 11_709), // dtSecs === 16.709, matching the incident
      units: [{ unitId: "eta", owned: 50 }], // the pre-prestige economy — wiped in `incoming`
      upgrades: []
    };
    const deltaEarned = 242184.99000047147;
    const verdict = evaluateSaveEnvelope(
      prev,
      USER_CREATED_AT,
      NOW,
      freshSave({
        tokens: deltaEarned,
        totalTokensEarned: prev.totalTokensEarned + deltaEarned,
        totalClicks: prev.totalClicks, // deltaClicks: 0, matching the incident
        elapsedSeconds: prev.elapsedSeconds + 11.3,
        phdCount: prev.phdCount + 1,
        prestigeCount: prev.prestigeCount + 1, // the prestige itself
        units: [] // post-reset — this is what made the OLD bound collapse to 0
      })
    );
    expect(verdict.outcome).not.toBe("reject");
  });

  it("still rejects earnings no economy (pre- or post-prestige) could have produced", () => {
    const prev: PrevSaveSnapshot = {
      tokens: 0,
      totalTokensEarned: 100,
      totalClicks: 1,
      elapsedSeconds: 1,
      phdCount: 0,
      prestigeCount: 0,
      savedAt: new Date(NOW.getTime() - 1000),
      units: [{ unitId: "alpha", owned: 1 }], // trivial pre-prestige economy
      upgrades: []
    };
    const verdict = evaluateSaveEnvelope(
      prev,
      USER_CREATED_AT,
      NOW,
      freshSave({
        tokens: 1e15,
        totalTokensEarned: prev.totalTokensEarned + 1e15, // absurd, neither economy supports it
        totalClicks: prev.totalClicks,
        elapsedSeconds: prev.elapsedSeconds + 1,
        phdCount: prev.phdCount,
        prestigeCount: prev.prestigeCount + 1,
        units: []
      })
    );
    expect(verdict.outcome).toBe("reject");
    if (verdict.outcome === "reject") expect(verdict.reason).toBe("earnings_exceed_max_possible");
  });
});

describe("evaluateSaveEnvelope — spend / free units", () => {
  it("rejects units granted without a matching token deduction", () => {
    const prev: PrevSaveSnapshot = {
      tokens: 5,
      totalTokensEarned: 5,
      totalClicks: 1,
      elapsedSeconds: 1,
      phdCount: 0,
      prestigeCount: 0,
      savedAt: new Date(NOW.getTime() - 1000),
      units: [],
      upgrades: []
    };
    // alpha's base cost is 10 — 50 owned units is not affordable from a
    // starting balance of 5 tokens, however earnings are reported.
    const verdict = evaluateSaveEnvelope(
      prev,
      USER_CREATED_AT,
      NOW,
      freshSave({
        tokens: 5,
        totalTokensEarned: 5,
        totalClicks: 1,
        elapsedSeconds: 1,
        units: [{ unitId: "alpha", owned: 50 }]
      })
    );
    expect(verdict.outcome).toBe("reject");
    if (verdict.outcome === "reject") expect(verdict.reason).toBe("spend_exceeds_available_budget");
  });

  // Regression: the affordability of a claimed purchase used to be checked
  // ONLY by comparing the reported `tokens` balance against
  // (budget - minSpend) — which trivially passes if the forged save simply
  // reports tokens: 0 ("I spent everything"), no matter how large minSpend
  // actually is. Reporting a suspiciously low leftover balance is not proof
  // the purchase was ever affordable; this must reject regardless of what
  // `tokens` value accompanies the claim.
  it("regression: rejects an unaffordable units claim even when tokens is reported as exactly 0", () => {
    const prev: PrevSaveSnapshot = {
      tokens: 5,
      totalTokensEarned: 5,
      totalClicks: 1,
      elapsedSeconds: 1,
      phdCount: 0,
      prestigeCount: 0,
      savedAt: new Date(NOW.getTime() - 1000),
      units: [],
      upgrades: []
    };
    const verdict = evaluateSaveEnvelope(
      prev,
      USER_CREATED_AT,
      NOW,
      freshSave({
        tokens: 0, // "spent everything" — must not be a free pass
        totalTokensEarned: 5,
        totalClicks: 1,
        elapsedSeconds: 1,
        units: [{ unitId: "alpha", owned: 50 }]
      })
    );
    expect(verdict.outcome).toBe("reject");
    if (verdict.outcome === "reject") expect(verdict.reason).toBe("spend_exceeds_available_budget");
  });

  // Regression: checkBound's clamp band used to collapse to zero width when
  // its bound was exactly 0 (bound*REJECT_MULTIPLIER is also 0), so any
  // float residue above FLOOR in a "spent every last token, nothing earned
  // or purchased since" save hard-rejected instead of silently clamping like
  // every other boundary case (maxTokensAfter = 0 here, by construction).
  it("regression: clamps (not rejects) a tiny float residue when the leftover-tokens bound is exactly 0", () => {
    const prev: PrevSaveSnapshot = {
      tokens: 0,
      totalTokensEarned: 0,
      totalClicks: 0,
      elapsedSeconds: 0,
      phdCount: 0,
      prestigeCount: 0,
      savedAt: new Date(NOW.getTime() - 1000),
      units: [],
      upgrades: []
    };
    const verdict = evaluateSaveEnvelope(
      prev,
      USER_CREATED_AT,
      NOW,
      freshSave({
        tokens: 0.0005, // a tiny, plausible float residue above FLOOR (1e-6)
        totalTokensEarned: 0,
        totalClicks: 0,
        elapsedSeconds: 0
      })
    );
    expect(verdict.outcome).not.toBe("reject");
  });

  it("accepts a purchase paid for out of earnings within the envelope", () => {
    // Starting fresh, earn (at most) the envelope's own click-value ceiling
    // and spend generously more than alpha's minimum possible cost on it —
    // spending MORE than the minimum required is always fine; only spending
    // LESS is a violation (see the next test).
    const earned = MAX_CLICK_VALUE_NO_UNITS * EARNED_ACCEPT_MARGIN; // 1 click's worth, at the envelope's own ceiling
    expect(earned).toBeGreaterThan(50); // sanity: comfortably covers alpha's cost at any discount
    const verdict = evaluateSaveEnvelope(
      null,
      USER_CREATED_AT,
      NOW,
      freshSave({
        tokens: earned - 50,
        totalTokensEarned: earned,
        totalClicks: 1,
        elapsedSeconds: 1,
        units: [{ unitId: "alpha", owned: 1 }]
      })
    );
    expect(verdict.outcome).toBe("accept");
  });

  it("uses a zero baseline for owned units when a prestige happened this interval", () => {
    // Previously owned 500 alpha units; a prestige (prestigeCount +1) wiped
    // them, and the new save reports only 2 owned — this must NOT be read as
    // "sold 498 units" (free, no cost) but as "bought 2 from scratch".
    const prev: PrevSaveSnapshot = {
      tokens: 0,
      totalTokensEarned: 2_000_000,
      totalClicks: 10,
      elapsedSeconds: 100,
      phdCount: 1,
      prestigeCount: 0,
      savedAt: new Date(NOW.getTime() - 1000),
      units: [{ unitId: "alpha", owned: 500 }],
      upgrades: []
    };
    const earned = MAX_CLICK_VALUE_NO_UNITS * EARNED_ACCEPT_MARGIN;
    const verdict = evaluateSaveEnvelope(
      prev,
      USER_CREATED_AT,
      NOW,
      freshSave({
        tokens: earned - 50, // pays generously more than the fresh unit's minimum cost
        totalTokensEarned: prev.totalTokensEarned + earned,
        totalClicks: prev.totalClicks + 1,
        elapsedSeconds: prev.elapsedSeconds + 1,
        phdCount: prev.phdCount,
        prestigeCount: prev.prestigeCount + 1,
        units: [{ unitId: "alpha", owned: 1 }]
      })
    );
    // Paying for the 1 fresh unit is accepted...
    expect(verdict.outcome).toBe("accept");

    const cheating = evaluateSaveEnvelope(
      prev,
      USER_CREATED_AT,
      NOW,
      freshSave({
        tokens: earned, // paid for NOTHING despite now owning 1 alpha unit
        totalTokensEarned: prev.totalTokensEarned + earned,
        totalClicks: prev.totalClicks + 1,
        elapsedSeconds: prev.elapsedSeconds + 1,
        phdCount: prev.phdCount,
        prestigeCount: prev.prestigeCount + 1,
        units: [{ unitId: "alpha", owned: 1 }]
      })
    );
    // ...but claiming the post-reset unit cost nothing is not, proving the
    // baseline really was reset to 0 rather than silently allowed for free
    // against the stale pre-prestige owned count.
    expect(cheating.outcome).not.toBe("accept");
  });

  // Regression, literal production incident: a real logged-in player's
  // autosave was repeatedly soft-clamped (5 times, escalating to a strike)
  // because checkBound's fixed FLOOR (1e-6) is an ABSOLUTE epsilon — once a
  // balance grows past ~1e6, ordinary float64 accumulation across many
  // tick() additions drifts well past a fixed absolute floor while staying
  // utterly negligible in RELATIVE terms. These are the exact tokens/bound
  // pair from that incident's AntiCheatEvent row (kind: envelope_clamp,
  // reason: tokens_exceed_after_required_spend) — an overshoot of 8.4e-6 on
  // a ~4.77e6 balance, i.e. ~1.8e-12 relative.
  it("regression: does not clamp a relative float residue on a large balance (real production incident)", () => {
    const deltaEarned = 667231.2599972486;
    const reportedTokens = 4765932.981958574; // the incident's actual `tokens`
    const bound = 4765932.981950127; // the incident's actual `maxTokensAfter` — 8.447e-6 below `tokens`
    const prevTokens = bound - deltaEarned; // => availableBudget === bound, reproducing the real overshoot
    const prev: PrevSaveSnapshot = {
      tokens: prevTokens,
      totalTokensEarned: 10_000_000,
      totalClicks: 1000,
      elapsedSeconds: 1000,
      phdCount: 0,
      prestigeCount: 0,
      savedAt: new Date(NOW.getTime() - 30_037), // dtSecs === 35.037, matching the incident
      units: [{ unitId: "theta", owned: 1 }], // large baseProduction so the earn bound clears easily
      upgrades: []
    };
    const verdict = evaluateSaveEnvelope(
      prev,
      USER_CREATED_AT,
      NOW,
      freshSave({
        tokens: reportedTokens,
        totalTokensEarned: prev.totalTokensEarned + deltaEarned,
        totalClicks: prev.totalClicks, // deltaClicks: 0, matching the incident
        elapsedSeconds: prev.elapsedSeconds + 28.85,
        phdCount: 0,
        prestigeCount: 0,
        units: prev.units // unchanged — no purchase, minSpend stays 0
      })
    );
    expect(verdict.outcome).toBe("accept");
  });
});

describe("evaluateSaveEnvelope — prestige/PhD plausibility", () => {
  it("rejects an inflated prestigeCount unsupported by lifetime earnings", () => {
    // totalClicks gives the earn-bound enough headroom that this fails on
    // the prestige check specifically, not an earlier one.
    const verdict = evaluateSaveEnvelope(
      null,
      USER_CREATED_AT,
      NOW,
      freshSave({ totalTokensEarned: 100, totalClicks: 1, prestigeCount: 1_000_000 })
    );
    expect(verdict.outcome).toBe("reject");
    if (verdict.outcome === "reject") expect(verdict.reason).toBe("prestige_count_exceeds_max_possible");
  });

  it("rejects an inflated phdCount even when prestigeCount is (independently) plausible", () => {
    // A prestigeCount matching totalTokensEarned so the prestige-count check
    // alone passes, but phdCount claims far more than the PhD bound allows.
    // totalClicks is large enough that the earn-bound comfortably covers
    // totalTokensEarned, so this fails on the PhD check specifically.
    const totalTokensEarned = 10 * PHD_TOKEN_SCALE;
    const verdict = evaluateSaveEnvelope(
      null,
      USER_CREATED_AT,
      NOW,
      freshSave({ totalTokensEarned, totalClicks: 100_000, prestigeCount: 10, phdCount: 1000 })
    );
    expect(verdict.outcome).toBe("reject");
    if (verdict.outcome === "reject") expect(verdict.reason).toBe("phd_exceeds_max_possible");
  });

  it("accepts the theoretical maximum PhDs for a given totalTokensEarned/prestigeCount pair", () => {
    // n runs of exactly PHD_TOKEN_SCALE tokens each, each granting exactly 1
    // PhD — the worst case the bound is derived to just barely cover.
    // totalClicks is large enough that the earn-bound itself never blocks
    // this — the point under test is the prestige/PhD bound specifically.
    const n = 20;
    const totalTokensEarned = n * PHD_TOKEN_SCALE;
    const verdict = evaluateSaveEnvelope(
      null,
      USER_CREATED_AT,
      NOW,
      freshSave({ totalTokensEarned, totalClicks: 30_000, prestigeCount: n, phdCount: n })
    );
    expect(verdict.outcome).not.toBe("reject");
  });

  // Regression: prestigeCount/phdCount used to have only a hard reject tier
  // (no clamp), so a value inside the normal "silently clamp" band (bound,
  // 2x bound] fell through unclamped instead of being corrected — the field
  // was accepted into the write completely as-claimed.
  it("regression: clamps (does not pass through unclamped) a prestigeCount within the reject-tolerance band", () => {
    // bound = totalTokensEarned / PHD_TOKEN_SCALE + PRESTIGE_COUNT_SLACK = 10 + 2 = 12.
    // 20 is within (12, 24] — inside the clamp band, not a reject.
    const totalTokensEarned = 10 * PHD_TOKEN_SCALE;
    const verdict = evaluateSaveEnvelope(
      null,
      USER_CREATED_AT,
      NOW,
      freshSave({ totalTokensEarned, totalClicks: 100_000, prestigeCount: 20, phdCount: 0 })
    );
    expect(verdict.outcome).toBe("clamp");
    if (verdict.outcome === "clamp") {
      expect(verdict.clamped.prestigeCount).toBe(12);
      expect(verdict.reasons).toContain("prestige_count_exceeds_max_possible");
    }
  });

  it("regression: clamps (does not pass through unclamped) a phdCount within the reject-tolerance band", () => {
    // prestigeCount itself is plausible (bound = 20 + 2 = 22, claimed 20 — ok).
    // phdBound = sqrt(20 * 20 * SCALE / SCALE) + 1 = 21. 30 is within (21, 42].
    const n = 20;
    const totalTokensEarned = n * PHD_TOKEN_SCALE;
    const verdict = evaluateSaveEnvelope(
      null,
      USER_CREATED_AT,
      NOW,
      freshSave({ totalTokensEarned, totalClicks: 30_000, prestigeCount: n, phdCount: 30 })
    );
    expect(verdict.outcome).toBe("clamp");
    if (verdict.outcome === "clamp") {
      expect(verdict.clamped.prestigeCount).toBeUndefined();
      expect(verdict.clamped.phdCount).toBe(21);
      expect(verdict.reasons).toContain("phd_exceeds_max_possible");
    }
  });
});
