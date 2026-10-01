import { describe, it, expect } from "vitest";
import {
  formatNumber,
  formatRate,
  formatTime,
  formatPercent,
  formatGain,
  formatChancePpm
} from "@/utils/formatters";

describe("formatNumber - regression", () => {
  it("matches the existing implementation's known values", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(999.9)).toBe("999");
    expect(formatNumber(1000)).toBe("1.00K");
    expect(formatNumber(1234)).toBe("1.23K");
    expect(formatNumber(1e6)).toBe("1.00M");
    expect(formatNumber(1.5e9)).toBe("1.50B");
    expect(formatNumber(1.234e12)).toBe("1.23T");
    expect(formatNumber(1234, 0)).toBe("1K");
    expect(formatNumber(1234, 3)).toBe("1.234K");
    expect(formatNumber(-5)).toBe("-5");
  });
});

describe("formatNumber - large-number fix", () => {
  it("no longer degrades past the old Oc ceiling", () => {
    expect(formatNumber(1e30)).toBe("1.00No");
    expect(formatNumber(1e33)).toBe("1.00Dc");
    expect(formatNumber(1e36)).toBe("1.00e36");
    expect(formatNumber(1.234e45)).toBe("1.23e45");
    expect(formatNumber(1e308)).toBe("1.00e308");
  });

  it("renders Infinity and NaN distinctly", () => {
    expect(formatNumber(Infinity)).toBe("∞");
    expect(formatNumber(NaN)).toBe("0");
  });

  it("monotonic width: the integer part never grows unbounded (the old failure mode)", () => {
    for (let e = 3; e <= 60; e++) {
      const out = formatNumber(Math.pow(10, e));
      const intPart = out.split(/[eA-Za-z]/)[0]!.replace(".", "").replace("-", "");
      // "1.00No" -> intPart "100" (3 digits incl. the 2 decimals); an
      // exponential fallback like "1.00e36" -> intPart "100" too. Either way
      // it must never balloon into an 18-digit string like the old bug.
      expect(intPart.length).toBeLessThanOrEqual(6);
    }
  });
});

describe("formatRate - regression", () => {
  it("matches the existing implementation's known values", () => {
    expect(formatRate(0)).toBe("0.00");
    expect(formatRate(0.3)).toBe("0.30");
    expect(formatRate(150)).toBe("150");
    expect(formatRate(1500)).toBe("1.50K");
  });
});

describe("formatRate - large-number fix", () => {
  it("shares the fixed suffix/exponential ladder with formatNumber", () => {
    expect(formatRate(1e36)).toBe("1.00e36");
  });

  it("renders Infinity distinctly", () => {
    expect(formatRate(Infinity)).toBe("∞");
  });
});

describe("formatPercent", () => {
  it("shows whole numbers without a decimal", () => {
    expect(formatPercent(0)).toBe("0");
    expect(formatPercent(1)).toBe("1");
    expect(formatPercent(4)).toBe("4");
    expect(formatPercent(50)).toBe("50");
  });

  it("keeps one decimal for a half-percent value instead of rounding it away", () => {
    // The bug this guards: Math.round(0.5) rounds UP in JS, so a 1-PhD 0.5%
    // discount used to display as "-1%" — double the real rate.
    expect(formatPercent(0.5)).toBe("0.5");
    expect(formatPercent(1.5)).toBe("1.5");
    expect(formatPercent(4.5)).toBe("4.5");
  });

  it("renders non-finite input as 0", () => {
    expect(formatPercent(Infinity)).toBe("0");
    expect(formatPercent(NaN)).toBe("0");
  });
});

describe("formatGain - regression", () => {
  it("trims the raw float from a fractional prestige multiplier to 2 decimals", () => {
    // The bug this guards: 32 PhD -> 1 + 0.02*32 === 1.6400000000000001, shown
    // to the player verbatim as "+1.6400000000000001".
    expect(formatGain(1 + 0.02 * 32)).toBe("1.64");
  });

  it("trims trailing zeros rather than always showing 2 decimals", () => {
    expect(formatGain(1)).toBe("1");
    expect(formatGain(1 + 0.02 * 50)).toBe("2"); // 50 PhD -> exactly x2
    expect(formatGain(1 + 0.02 * 25)).toBe("1.5"); // 25 PhD (odd) -> x1.5
  });

  it("carries a value that rounds up to 1000 onto the suffix ladder", () => {
    expect(formatGain(999.996)).toBe("1.00K");
    expect(formatGain(999.994)).toBe("999.99");
  });

  it("shares the suffix/exponential ladder with formatNumber above 1000", () => {
    expect(formatGain(1234)).toBe("1.23K");
    expect(formatGain(1e36)).toBe("1.00e36");
  });

  it("renders non-finite input distinctly", () => {
    expect(formatGain(Infinity)).toBe("∞");
    expect(formatGain(NaN)).toBe("0");
  });
});

describe("formatTime - regression", () => {
  it("matches the existing implementation's known values", () => {
    expect(formatTime(0)).toBe("0s");
    expect(formatTime(59)).toBe("59s");
    expect(formatTime(60)).toBe("1m 0s");
    expect(formatTime(3599)).toBe("59m 59s");
    expect(formatTime(3600)).toBe("1h 0m");
    expect(formatTime(7265)).toBe("2h 1m");
  });
});

describe("formatChancePpm", () => {
  it("shows a whole-number chance without a decimal", () => {
    expect(formatChancePpm(450_000)).toBe("45");
    expect(formatChancePpm(800_000)).toBe("80");
    expect(formatChancePpm(1_000_000)).toBe("100");
  });

  // The same trap formatPercent documents: Math.round(2.5) is 3, which would show
  // double-ish of the real chance. Up to two decimals are kept, trailing zeros trimmed.
  it("regression: keeps a fractional chance instead of rounding it (2.5%, 0.9%, 97.5%)", () => {
    expect(formatChancePpm(25_000)).toBe("2.5");
    expect(formatChancePpm(9_000)).toBe("0.9");
    expect(formatChancePpm(975_000)).toBe("97.5");
    expect(formatChancePpm(206_896)).toBe("20.69");
  });

  it("trims only trailing zeros, never a zero that is part of the number", () => {
    expect(formatChancePpm(100_000)).toBe("10");
    expect(formatChancePpm(105_000)).toBe("10.5");
    expect(formatChancePpm(10_000)).toBe("1");
    expect(formatChancePpm(0)).toBe("0");
  });

  it("is safe on a non-finite input", () => {
    expect(formatChancePpm(NaN)).toBe("0");
    expect(formatChancePpm(Infinity)).toBe("0");
  });
});
