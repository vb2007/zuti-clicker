import { describe, it, expect } from "@jest/globals";
import {
  evaluateSaveEnvelope,
  graceLeadNeeds,
  type PrevSaveSnapshot,
  type IncomingSave
} from "../services/saveValidator.js";
import { decideGraceLead } from "../services/graceLead.js";
import { emptyCareerModifiers } from "../services/careerCore.js";
import {
  CLOCK_GRACE_SECS,
  ENVELOPE_MAX_CPS,
  SAVE_LEAD_CAP_SECS,
  SAVE_LEAD_DECAY_PER_SEC
} from "../constants/antiCheat.js";

// Pure unit tests for the grace-lead ledger (services/graceLead.ts) and the
// needs it charges (saveValidator.ts's graceLeadNeeds). The HTTP side — the
// 429, what gets stored, no strike — is saveRateLimit.test.ts.

const NOW = new Date("2026-01-01T00:01:00.000Z");
const USER_CREATED_AT = new Date("2025-01-01T00:00:00.000Z");

function prevSave(overrides: Partial<PrevSaveSnapshot> = {}): PrevSaveSnapshot {
  return {
    tokens: 0,
    totalTokensEarned: 3_000_000,
    totalClicks: 100,
    elapsedSeconds: 1000,
    phdCount: 0,
    prestigeCount: 1,
    upgraderNet: 0,
    phdInvested: 0,
    career: emptyCareerModifiers(),
    savedAt: new Date(NOW.getTime() - 1000),
    units: [{ unitId: "alpha", owned: 100 }],
    upgrades: [],
    ...overrides
  };
}

function next(prev: PrevSaveSnapshot, overrides: Partial<IncomingSave> = {}): IncomingSave {
  return {
    tokens: prev.tokens,
    totalTokensEarned: prev.totalTokensEarned,
    totalClicks: prev.totalClicks,
    elapsedSeconds: prev.elapsedSeconds + 1,
    phdCount: prev.phdCount,
    prestigeCount: prev.prestigeCount,
    units: prev.units,
    upgrades: prev.upgrades,
    ...overrides
  };
}

const honest = { elapsed: 0, clicks: -1, earnings: -1 };

describe("decideGraceLead", () => {
  it("an honest save draws nothing and may use the whole budget as grace", () => {
    const d = decideGraceLead(0, 15, honest);
    expect(d).toMatchObject({ lead: 0, need: 0, nextLead: 0, overBy: 0, retryAfterMs: 0 });
    expect(d.graceSecs).toBe(SAVE_LEAD_CAP_SECS);
    // ...but earnings only the old fixed grace: they don't draw on the lead.
    expect(d.earningsGraceSecs).toBe(CLOCK_GRACE_SECS);
  });

  it("never offers less than the old fixed grace, however far ahead the chain is", () => {
    expect(decideGraceLead(SAVE_LEAD_CAP_SECS, 0, honest).graceSecs).toBe(CLOCK_GRACE_SECS);
    expect(decideGraceLead(SAVE_LEAD_CAP_SECS - 1, 0, honest).graceSecs).toBe(CLOCK_GRACE_SECS);
  });

  it("drains the stored lead with the wall clock, never below 0", () => {
    expect(decideGraceLead(20, 100, honest).lead).toBeCloseTo(20 - 100 * SAVE_LEAD_DECAY_PER_SEC);
    expect(decideGraceLead(1, 3600, honest).lead).toBe(0);
  });

  it("charges the larger of the elapsed and clicks needs", () => {
    expect(decideGraceLead(0, 1, { elapsed: 2, clicks: 3, earnings: -1 }).need).toBe(3);
    expect(decideGraceLead(0, 1, { elapsed: 4, clicks: 3, earnings: -1 }).need).toBe(4);
  });

  it("gives back at most what the chain is ahead by: nothing can be banked", () => {
    const d = decideGraceLead(3, 0, { elapsed: -50, clicks: -50, earnings: -50 });
    expect(d.need).toBe(-3);
    expect(d.nextLead).toBe(0);
    expect(decideGraceLead(0, 0, { elapsed: -50, clicks: -50, earnings: -50 }).nextLead).toBe(0);
  });

  it("caps a save's draw at the grace it may use (the envelope clamps the rest)", () => {
    const d = decideGraceLead(0, 0, { elapsed: 1000, clicks: 0, earnings: 0 });
    expect(d.need).toBe(SAVE_LEAD_CAP_SECS);
    // Lands exactly on the cap: accepted (clamped by the envelope), not refused.
    expect(d.overBy).toBe(0);
    expect(d.nextLead).toBe(SAVE_LEAD_CAP_SECS);
  });

  it("refuses a save past the cap, retrying once the lead has drained enough", () => {
    const d = decideGraceLead(SAVE_LEAD_CAP_SECS - 1, 0, { elapsed: 3, clicks: 0, earnings: 0 });
    expect(d.overBy).toBeCloseTo(2);
    expect(d.retryAfterMs).toBe(Math.ceil((2 / SAVE_LEAD_DECAY_PER_SEC) * 1000));
    // After waiting that long the claim and the interval have grown together,
    // so the need is the same — and the drained lead now leaves room for it.
    const later = decideGraceLead(SAVE_LEAD_CAP_SECS - 1, d.retryAfterMs / 1000, {
      elapsed: 3,
      clicks: 0,
      earnings: 0
    });
    expect(later.overBy).toBe(0);
  });

  it("float noise on the cap is not over it", () => {
    const lead = 10.1;
    const d = decideGraceLead(lead, 0, { elapsed: 1e9, clicks: 0, earnings: 0 });
    expect(d.need).toBeCloseTo(SAVE_LEAD_CAP_SECS - lead);
    expect(d.overBy).toBe(0);
  });

  it("earnings don't draw on the lead yet; the shadow lead (withEarnings) does", () => {
    const needs = { elapsed: 0, clicks: 0, earnings: 4 };
    expect(decideGraceLead(SAVE_LEAD_CAP_SECS - 1, 0, needs)).toMatchObject({ need: 0, overBy: 0 });
    const shadow = decideGraceLead(SAVE_LEAD_CAP_SECS - 1, 0, needs, true);
    expect(shadow.need).toBe(4);
    expect(shadow.overBy).toBeCloseTo(3);
    expect(shadow.earningsGraceSecs).toBe(shadow.graceSecs);
  });

  // Regression (review of 1.7.4): the envelope's earnings bound used the
  // whole grace the lead allowed — up to the cap — while earnings never drew
  // on it: honest playtime and clicks (no lead), forged earnings, 30 s of
  // free production per save instead of the old 5 s.
  it("earnings may use only the grace the save's playtime and clicks drew", () => {
    expect(decideGraceLead(0, 1, { elapsed: 0, clicks: -1, earnings: 30 }).earningsGraceSecs).toBe(
      CLOCK_GRACE_SECS
    );
    // A stalled upload: the playtime drew 12 s, so earnings may cover them too.
    expect(decideGraceLead(0, 1, { elapsed: 12, clicks: -1, earnings: 12 }).earningsGraceSecs).toBe(
      12
    );
  });

  // The whole point: saving ten times a second, each save claiming the full
  // old grace, gets no further than the cap plus the drain over the stretch.
  it("a save spammer runs at most the cap ahead, plus the drain", () => {
    let stored = 0;
    let sinceWrite = 0;
    let claimed = 0;
    let refused = 0;
    const dt = 0.1;
    const steps = 600; // a minute
    for (let i = 0; i < steps; i++) {
      sinceWrite += dt;
      // Each save claims the time since the last written one plus the old grace.
      const need = CLOCK_GRACE_SECS;
      const d = decideGraceLead(stored, sinceWrite, { elapsed: need, clicks: need, earnings: 0 });
      if (d.overBy > 0) {
        refused++; // nothing written: the stored lead and its anchor stay put
        continue;
      }
      claimed += sinceWrite + d.need;
      stored = d.nextLead;
      sinceWrite = 0;
    }
    const wall = steps * dt;
    expect(refused).toBeGreaterThan(steps / 2);
    expect(claimed).toBeLessThanOrEqual(wall + SAVE_LEAD_CAP_SECS + SAVE_LEAD_DECAY_PER_SEC * wall);
    // Without the ledger: (dt + grace) per save.
    expect(steps * (dt + CLOCK_GRACE_SECS)).toBeGreaterThan(50 * wall);
  });
});

describe("graceLeadNeeds", () => {
  it("elapsed and clicks: how far past the wall clock the claims reach", () => {
    const prev = prevSave();
    const needs = graceLeadNeeds(
      prev,
      next(prev, { elapsedSeconds: prev.elapsedSeconds + 7, totalClicks: prev.totalClicks + 90 }),
      5
    );
    expect(needs.elapsed).toBeCloseTo(2);
    expect(needs.clicks).toBeCloseTo(90 / ENVELOPE_MAX_CPS - 5);
  });

  // The closed form must agree with the envelope itself: at exactly that much
  // grace the bound holds, with a little less it doesn't.
  it.each([
    ["elapsed", { elapsedSeconds: 1000 + 9 }],
    ["clicks", { totalClicks: 100 + 400 }],
    ["earnings", { totalTokensEarned: 3_000_000 + 2_000, tokens: 2_000 }]
  ] as const)("the %s need is the grace at which the envelope just accepts", (dim, over) => {
    const prev = prevSave();
    const incoming = next(prev, over);
    const dtReal = (NOW.getTime() - prev.savedAt.getTime()) / 1000;
    const need = graceLeadNeeds(prev, incoming, dtReal)[dim];
    expect(need).toBeGreaterThan(0);
    const at = (g: number) => evaluateSaveEnvelope(prev, USER_CREATED_AT, NOW, incoming, g);
    expect(at(need * (1 + 1e-9) + 1e-9).outcome).toBe("accept");
    expect(at(need * 0.99).outcome).toBe("clamp");
  });

  // Regression (review of 1.7.4): an earnings-only spammer — honest playtime
  // and clicks, so no lead — got the whole cap as the earnings bound's grace.
  it("an earnings-only spammer gets no more earnings grace than the old 5 s", () => {
    const prev = prevSave({ savedAt: new Date(NOW.getTime() - 100) });
    const honestTime = { elapsedSeconds: prev.elapsedSeconds + 0.1 };
    const needAt = (earned: number) =>
      graceLeadNeeds(prev, next(prev, { ...honestTime, totalTokensEarned: earned }), 0.1);
    // The earnings that need 20 s of grace (the need is linear in them):
    // inside the cap's grace, more than twice past the old fixed one.
    const base = prev.totalTokensEarned;
    const slope = needAt(base + 1).earnings - needAt(base).earnings;
    const earned = base + (20 - needAt(base).earnings) / slope;
    expect(needAt(earned).earnings).toBeCloseTo(20);
    const incoming = next(prev, {
      ...honestTime,
      totalTokensEarned: earned,
      tokens: earned - base
    });
    const d = decideGraceLead(0, 0.1, graceLeadNeeds(prev, incoming, 0.1));
    expect(d.need).toBeCloseTo(0);
    const verdict = evaluateSaveEnvelope(
      prev,
      USER_CREATED_AT,
      NOW,
      incoming,
      d.graceSecs,
      d.earningsGraceSecs
    );
    expect(verdict.outcome).toBe("reject");
    // The bug: the earnings bound at the lead's whole grace accepted it.
    expect(evaluateSaveEnvelope(prev, USER_CREATED_AT, NOW, incoming, d.graceSecs).outcome).toBe(
      "accept"
    );
  });

  it("earnings with no production: unbounded when clicks can't explain them", () => {
    const prev = prevSave({ units: [] });
    const fine = graceLeadNeeds(prev, next(prev, { totalClicks: 101 }), 1);
    expect(fine.earnings).toBe(Number.NEGATIVE_INFINITY);
    const forged = graceLeadNeeds(prev, next(prev, { totalTokensEarned: 9e9, tokens: 9e9 }), 1);
    expect(forged.earnings).toBe(Number.POSITIVE_INFINITY);
  });
});
