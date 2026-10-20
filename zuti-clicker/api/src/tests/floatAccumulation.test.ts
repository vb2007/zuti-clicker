import { describe, it, expect } from "@jest/globals";
import {
  evaluateSaveEnvelope,
  type PrevSaveSnapshot,
  type IncomingSave
} from "../services/saveValidator.js";
import { emptyCareerModifiers } from "../services/careerCore.js";

// Regression (live review of 1.7.4): the client adds every click and every
// tick's production to `tokens` and to `totalTokensEarned` separately, and at
// a lifetime total near 1e15 a float64 step is a whole token — each addition
// of a fractional amount (40.3 a click) loses up to half a step there, while
// the small `tokens` keeps it. Between two saves with nothing bought, the
// leftover check (tokens <= previous tokens + earned) then saw tokens nobody
// earned, every save a MATERIAL clamp: ten of them and an honest clicker was
// struck (envelope_clamp_pattern). The production leader is at 1.7e14 today.

const NOW = new Date("2026-01-01T00:00:15.000Z");
const USER_CREATED_AT = new Date("2025-01-01T00:00:00.000Z");
const TICK_RATE = 20; // frontend gameConstants.ts

function prevSave(totalTokensEarned: number): PrevSaveSnapshot {
  return {
    tokens: 50,
    totalTokensEarned,
    totalClicks: 1_000_000,
    elapsedSeconds: 1_000_000,
    phdCount: 0,
    prestigeCount: 1,
    upgraderNet: 0,
    phdInvested: 0,
    career: emptyCareerModifiers(),
    savedAt: new Date(NOW.getTime() - 15_000),
    units: [{ unitId: "alpha", owned: 100 }],
    upgrades: []
  };
}

// 15 s of play exactly as the client accumulates it: 4 clicks/s worth 40.3
// each, and 100 alpha's production (30/s) added every tick.
function play(prev: PrevSaveSnapshot): IncomingSave {
  let tokens = prev.tokens;
  let earned = prev.totalTokensEarned;
  let clicks = 0;
  for (let tick = 1; tick <= 15 * TICK_RATE; tick++) {
    tokens += 30 / TICK_RATE;
    earned += 30 / TICK_RATE;
    if (tick % (TICK_RATE / 4) === 0) {
      tokens += 40.3;
      earned += 40.3;
      clicks++;
    }
  }
  return {
    tokens,
    totalTokensEarned: earned,
    totalClicks: prev.totalClicks + clicks,
    elapsedSeconds: prev.elapsedSeconds + 15,
    phdCount: prev.phdCount,
    prestigeCount: prev.prestigeCount,
    units: prev.units,
    upgrades: prev.upgrades
  };
}

describe("float accumulation at huge lifetime totals", () => {
  it.each([1.7e14, 1e15, 5e15, 3e16])(
    "honest play with %s lifetime tokens is never a material clamp",
    (lifetime) => {
      const prev = prevSave(lifetime);
      const incoming = play(prev);
      // The drift is real: tokens and the lifetime total disagree by whole
      // tokens (either way — an addition can round up or down).
      if (lifetime >= 1e15) {
        const drift =
          incoming.tokens - prev.tokens - (incoming.totalTokensEarned - prev.totalTokensEarned);
        expect(Math.abs(drift)).toBeGreaterThan(1);
      }
      const verdict = evaluateSaveEnvelope(prev, USER_CREATED_AT, NOW, incoming);
      expect(verdict.outcome === "accept" || (verdict.outcome === "clamp" && !verdict.material)).toBe(
        true
      );
    }
  );

  it("still clamps tokens nobody earned, well past the rounding", () => {
    const prev = prevSave(5e15);
    const incoming = play(prev);
    const verdict = evaluateSaveEnvelope(prev, USER_CREATED_AT, NOW, {
      ...incoming,
      tokens: incoming.tokens + 5000
    });
    expect(verdict.outcome).not.toBe("accept");
  });
});
