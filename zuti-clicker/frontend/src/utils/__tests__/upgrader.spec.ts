import { describe, it, expect, vi, afterEach } from "vitest";
import {
  toHundredths,
  quoteSpin,
  isWinningRoll,
  settleSpin,
  rollPpmLocal,
  sliderToMultiplier,
  multiplierToSlider
} from "@/utils/upgrader";
import {
  UPGRADER_PPM,
  UPGRADER_RTP,
  UPGRADER_WIN_CHANCE_CAP,
  UPGRADER_CONSOLATION_MIN_GRANT_MS,
  UPGRADER_CONSOLATION_MAX_REMAINING_MS,
  UPGRADER_PRESET_MULTIPLIERS
} from "@/utils/gameConstants";

// The golden-vector table (upgrader-parity.spec.ts) pins exact values and ties
// this file to the server's; these pin the properties that make the wheel safe,
// plus the client-only pieces (guest settlement, the local roll, the slider).

describe("quoteSpin properties", () => {
  it("is exact where plain float math is not (x4.35 -> 435, not 434)", () => {
    expect(Math.floor(100 * 4.35)).toBe(434);
    expect(quoteSpin(100, toHundredths(4.35)!)!.payout).toBe(435);
  });

  it("clamps the win chance to the cap (9 x 1.2 would be 81% uncapped)", () => {
    const q = quoteSpin(9, 120)!;
    expect(q.payout).toBe(10);
    expect(q.winPpm).toBe(UPGRADER_WIN_CHANCE_CAP * UPGRADER_PPM);
  });

  it("never exceeds the cap or the return target, for any stake and multiplier", () => {
    let checked = 0;
    for (let i = 0; i < 20_000; i++) {
      const stake = i < 5000 ? 1 + (i % 500) : i < 15000 ? 1 + i * 7919 : 2_147_483_647 - (i % 100);
      const q = quoteSpin(stake, 120 + ((i * 31) % 9881));
      if (q === null) continue;
      checked++;
      expect(q.payout).toBeGreaterThan(stake);
      expect(q.winPpm).toBeLessThanOrEqual(UPGRADER_WIN_CHANCE_CAP * UPGRADER_PPM);
      expect(((q.winPpm / UPGRADER_PPM) * q.payout) / stake).toBeLessThanOrEqual(UPGRADER_RTP + 1e-12);
    }
    expect(checked).toBeGreaterThan(15_000);
  });

  it("every preset multiplier is a valid multiplier", () => {
    for (const m of UPGRADER_PRESET_MULTIPLIERS) expect(toHundredths(m)).not.toBeNull();
  });
});

describe("settleSpin (guest-mode settlement)", () => {
  // x2 on 100: payout 200, win chance 45% = rolls [0, 450000).
  it("a roll below the win chance wins: the stake is replaced by the payout", () => {
    const out = settleSpin(100, 200, 500, 449_999)!;
    expect(out.won).toBe(true);
    expect(out.phdCount).toBe(500 + 200 - 100);
    expect(out.consolation).toBeUndefined();
  });

  it("a roll at the win chance loses: the stake is gone and a frenzy is granted", () => {
    const out = settleSpin(100, 200, 500, 450_000)!;
    expect(out.won).toBe(false);
    expect(out.phdCount).toBe(400);
    expect(out.consolation).toEqual({ boosterId: "frenzy", remainingMs: 12_000 }); // 100/500 of 60s
  });

  it("reports the same roll and chance it was given (the wheel lands exactly there)", () => {
    const out = settleSpin(100, 200, 500, 123_456)!;
    expect(out.rollPpm).toBe(123_456);
    expect(out.winPpm).toBe(450_000);
    expect(out.payout).toBe(200);
  });

  it("refuses an invalid bet or a stake the player does not have", () => {
    expect(settleSpin(1, 150, 500, 0)).toBeNull(); // payout would not exceed stake
    expect(settleSpin(501, 200, 500, 0)).toBeNull(); // more than owned
    expect(settleSpin(0, 200, 500, 0)).toBeNull();
  });

  // The review finding: a minimum buff length let a player with many PhDs keep
  // frenzy up almost for free by staking 1 PhD repeatedly.
  it("regression: a tiny stake earns no frenzy at all — there is no minimum to farm", () => {
    const out = settleSpin(1, 200, 1_000_000, 999_999)!;
    expect(out.won).toBe(false);
    expect(out.phdCount).toBe(999_999);
    expect(out.consolation).toBeUndefined();
  });

  it("a stake just under the grant threshold earns nothing; at it, exactly the threshold", () => {
    expect(settleSpin(1, 200, 61, 999_999)!.consolation).toBeUndefined();
    expect(settleSpin(1, 200, 60, 999_999)!.consolation!.remainingMs).toBe(
      UPGRADER_CONSOLATION_MIN_GRANT_MS
    );
  });

  it("a loss with no consolation leaves a running frenzy exactly as it was", () => {
    const out = settleSpin(1, 200, 1_000_000, 999_999, 45_000)!;
    expect(out.consolation).toBeUndefined();
  });

  it("a loss extends a running frenzy but never past the cap, and never shortens it", () => {
    // All-in: 60s on top of 100s already running would be 160s — capped at 120s.
    expect(settleSpin(100, 200, 100, 999_999, 100_000)!.consolation!.remainingMs).toBe(
      UPGRADER_CONSOLATION_MAX_REMAINING_MS
    );
    // Already above the cap (e.g. a booster-duration upgrade): left as it was.
    expect(settleSpin(100, 200, 100, 999_999, 150_000)!.consolation!.remainingMs).toBe(150_000);
    // Below the cap: simply extended.
    expect(settleSpin(100, 200, 200, 999_999, 20_000)!.consolation!.remainingMs).toBe(50_000);
  });
});

describe("isWinningRoll", () => {
  it("wins strictly below winPpm", () => {
    expect(isWinningRoll(0, 1)).toBe(true);
    expect(isWinningRoll(1, 1)).toBe(false);
  });
});

describe("rollPpmLocal (guest roll)", () => {
  afterEach(() => vi.restoreAllMocks());

  function stubDraws(...draws: number[]) {
    const queue = [...draws];
    vi.spyOn(crypto, "getRandomValues").mockImplementation(((arr: Uint32Array) => {
      arr[0] = queue.shift()!;
      return arr;
    }) as typeof crypto.getRandomValues);
  }

  it("maps a draw into [0, PPM)", () => {
    stubDraws(0);
    expect(rollPpmLocal()).toBe(0);
    stubDraws(UPGRADER_PPM + 7);
    expect(rollPpmLocal()).toBe(7);
  });

  it("rejects draws in the biased tail instead of folding them back (no modulo bias)", () => {
    const limit = 2 ** 32 - (2 ** 32 % UPGRADER_PPM);
    // limit and above would over-represent the low rolls — it must redraw.
    stubDraws(2 ** 32 - 1, limit, limit - 1);
    expect(rollPpmLocal()).toBe((limit - 1) % UPGRADER_PPM);
  });

  it("always lands in range with the real CSPRNG", () => {
    for (let i = 0; i < 2000; i++) {
      const r = rollPpmLocal();
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(UPGRADER_PPM);
    }
  });
});

describe("slider <-> multiplier", () => {
  it("spans exactly x1.2 .. x100", () => {
    expect(sliderToMultiplier(0)).toBe(1.2);
    expect(sliderToMultiplier(1)).toBe(100);
    expect(sliderToMultiplier(-5)).toBe(1.2);
    expect(sliderToMultiplier(5)).toBe(100);
  });

  it("only ever produces valid multipliers (at most 2 decimals, in range)", () => {
    for (let i = 0; i <= 1000; i++) {
      expect(toHundredths(sliderToMultiplier(i / 1000))).not.toBeNull();
    }
  });

  it("is monotonic", () => {
    let prev = 0;
    for (let i = 0; i <= 1000; i++) {
      const m = sliderToMultiplier(i / 1000);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it("round-trips: the slider position of a multiplier maps back to that multiplier", () => {
    for (const m of [1.2, 1.5, 2, 3, 4.35, 5, 10, 33.33, 100]) {
      expect(sliderToMultiplier(multiplierToSlider(m))).toBe(m);
    }
  });

  it("gives the useful low end real estate (x10 sits around the middle, not the first tenth)", () => {
    const t = multiplierToSlider(10);
    expect(t).toBeGreaterThan(0.4);
    expect(t).toBeLessThan(0.6);
  });
});
