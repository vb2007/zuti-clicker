import { describe, it, expect } from "@jest/globals";
import { toHundredths, quoteSpin, consolationMs, isWinningRoll } from "../services/upgrader.js";
import {
  UPGRADER_PPM,
  UPGRADER_RTP,
  UPGRADER_WIN_CHANCE_CAP,
  UPGRADER_CONSOLATION_MIN_MS,
  UPGRADER_CONSOLATION_BASE_MS
} from "../constants/upgrader.js";

// Pure unit tests — no live server. The golden-vector table
// (upgrader-parity.test.ts) pins exact values; these pin the properties that
// make the wheel safe: it can never return more than UPGRADER_RTP on average,
// never offers a win chance above the cap, and never mis-prices because of
// float representation error.

describe("toHundredths", () => {
  it("is exact where plain float math is not (x4.35 -> 435, not 434)", () => {
    // The hazard this module exists to avoid: floor(100 * 4.35) is 434.
    expect(Math.floor(100 * 4.35)).toBe(434);
    expect(toHundredths(4.35)).toBe(435);
    expect(quoteSpin(100, toHundredths(4.35)!)!.payout).toBe(435);
  });

  it("rejects anything that is not a finite number with at most 2 decimals in range", () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -1, 1.19, 1.005, 100.01, 1_000_000]) {
      expect(toHundredths(bad)).toBeNull();
    }
    expect(toHundredths("2" as unknown as number)).toBeNull();
    expect(toHundredths(null as unknown as number)).toBeNull();
    expect(toHundredths(undefined as unknown as number)).toBeNull();
  });

  it("accepts both ends of the range and every hundredth between", () => {
    expect(toHundredths(1.2)).toBe(120);
    expect(toHundredths(100)).toBe(10_000);
    for (let h = 120; h <= 10_000; h++) {
      // Simulates what a slider with step 0.01 produces after JSON round-trip.
      expect(toHundredths(JSON.parse(JSON.stringify(h / 100)) as number)).toBe(h);
    }
  });
});

describe("quoteSpin", () => {
  it("rejects non-positive, fractional and gain-less bets", () => {
    expect(quoteSpin(0, 200)).toBeNull();
    expect(quoteSpin(-1, 200)).toBeNull();
    expect(quoteSpin(1.5, 200)).toBeNull();
    expect(quoteSpin(NaN, 200)).toBeNull();
    // 1 x 1.5 floors to 1 — a "win" that gains nothing is not offered.
    expect(quoteSpin(1, 150)).toBeNull();
    expect(quoteSpin(4, 120)).toBeNull();
  });

  it("clamps the win chance to the cap (9 x 1.2 would be 81% uncapped)", () => {
    const q = quoteSpin(9, 120)!;
    expect(q.payout).toBe(10);
    expect((UPGRADER_RTP * 9) / 10).toBeGreaterThan(UPGRADER_WIN_CHANCE_CAP);
    expect(q.winPpm).toBe(UPGRADER_WIN_CHANCE_CAP * UPGRADER_PPM);
  });

  it("never exceeds the cap or the return target, for any stake and multiplier", () => {
    let checked = 0;
    for (let i = 0; i < 20_000; i++) {
      // A deterministic spread: small stakes (where rounding bites hardest),
      // mid stakes and the INT32 extreme, against every multiplier hundredth.
      const stake = i < 5000 ? 1 + (i % 500) : i < 15000 ? 1 + i * 7919 : 2_147_483_647 - (i % 100);
      const h = 120 + ((i * 31) % 9881);
      const q = quoteSpin(stake, h);
      if (q === null) continue;
      checked++;
      expect(Number.isInteger(q.payout)).toBe(true);
      expect(Number.isInteger(q.winPpm)).toBe(true);
      expect(q.payout).toBeGreaterThan(stake);
      expect(q.winPpm).toBeGreaterThan(0);
      expect(q.winPpm).toBeLessThanOrEqual(UPGRADER_WIN_CHANCE_CAP * UPGRADER_PPM);
      // Expected return per staked PhD = winChance * payout / stake. Flooring
      // winPpm means it can only land at or below the target, never above.
      const rtp = ((q.winPpm / UPGRADER_PPM) * q.payout) / stake;
      expect(rtp).toBeLessThanOrEqual(UPGRADER_RTP + 1e-12);
    }
    expect(checked).toBeGreaterThan(15_000);
  });

  it("stays within safe-integer range at the INT32 / x100 extreme", () => {
    const q = quoteSpin(2_147_483_647, 10_000)!;
    expect(Number.isSafeInteger(q.payout)).toBe(true);
    expect(q.payout).toBe(214_748_364_700);
  });
});

describe("isWinningRoll", () => {
  it("wins strictly below winPpm — a chance of N ppm covers exactly N rolls", () => {
    expect(isWinningRoll(0, 1)).toBe(true);
    expect(isWinningRoll(1, 1)).toBe(false);
    expect(isWinningRoll(999_999, UPGRADER_PPM)).toBe(true);
    expect(isWinningRoll(500_000, 500_000)).toBe(false);
    expect(isWinningRoll(499_999, 500_000)).toBe(true);
  });
});

describe("consolationMs", () => {
  it("scales with the share of PhDs put up, with a floor", () => {
    expect(consolationMs(100, 100)).toBe(UPGRADER_CONSOLATION_BASE_MS);
    expect(consolationMs(50, 100)).toBe(UPGRADER_CONSOLATION_BASE_MS / 2);
    expect(consolationMs(1, 1000)).toBe(UPGRADER_CONSOLATION_MIN_MS);
  });

  it("never divides by zero", () => {
    expect(consolationMs(5, 0)).toBe(UPGRADER_CONSOLATION_MIN_MS);
  });
});
