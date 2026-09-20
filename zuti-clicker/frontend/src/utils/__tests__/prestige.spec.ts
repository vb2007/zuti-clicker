import { describe, it, expect } from "vitest";
import {
  getPhdGain,
  getPhdThreshold,
  isPrestigeAvailable,
  getProductionMultiplier,
  getCostMultiplier,
  getTokensToNextPhd,
  getPrestigeProgress,
  getPrestigeOutcome
} from "@/utils/prestige";

describe("getPhdGain", () => {
  it("returns 0 below the unlock threshold", () => {
    expect(getPhdGain(0)).toBe(0);
    expect(getPhdGain(1)).toBe(0);
    expect(getPhdGain(999_999)).toBe(0);
  });

  it("boundary values around each PhD threshold", () => {
    expect(getPhdGain(1_000_000)).toBe(1);
    expect(getPhdGain(1_000_001)).toBe(1);
    expect(getPhdGain(3_999_999)).toBe(1);
    expect(getPhdGain(4_000_000)).toBe(2);
    expect(getPhdGain(8_999_999)).toBe(2);
    expect(getPhdGain(9_000_000)).toBe(3);
  });

  it("larger values", () => {
    expect(getPhdGain(144_000_000)).toBe(12);
    expect(getPhdGain(1e12)).toBe(1000);
    expect(getPhdGain(1e18)).toBe(1_000_000);
  });

  it("clamps negative/non-finite input to 0", () => {
    expect(getPhdGain(-1)).toBe(0);
    expect(getPhdGain(NaN)).toBe(0);
    expect(getPhdGain(Infinity)).toBe(0);
  });

  // Exactness property: the naive floor(sqrt(t/S)) rounds up onto a perfect
  // square once t/S loses precision. Verified myself against the float64
  // representability ceiling — k=100000 sits past it (k^2*1e6 - 1 is not
  // distinguishable from k^2*1e6 in a double), so it is deliberately excluded.
  it.each([1, 2, 10, 1000, 65536, 65537, 65538, 90000])(
    "is exact at k=%i: k^2*SCALE -> k, k^2*SCALE - 1 -> k-1",
    (k) => {
      const scale = 1_000_000;
      expect(getPhdGain(k * k * scale)).toBe(k);
      expect(getPhdGain(k * k * scale - 1)).toBe(k - 1);
    }
  );
});

describe("getPhdThreshold", () => {
  it("is the inverse of getPhdGain at exact boundaries", () => {
    expect(getPhdThreshold(0)).toBe(0);
    expect(getPhdThreshold(1)).toBe(1_000_000);
    expect(getPhdThreshold(2)).toBe(4_000_000);
    expect(getPhdThreshold(10)).toBe(100_000_000);
  });
});

describe("isPrestigeAvailable", () => {
  it("false below 1e6, true at and above", () => {
    expect(isPrestigeAvailable(999_999)).toBe(false);
    expect(isPrestigeAvailable(1_000_000)).toBe(true);
  });
});

describe("getProductionMultiplier", () => {
  it("known values", () => {
    expect(getProductionMultiplier(0)).toBe(1);
    expect(getProductionMultiplier(1)).toBe(1.02);
    expect(getProductionMultiplier(3)).toBeCloseTo(1.06, 10);
    expect(getProductionMultiplier(50)).toBe(2);
    expect(getProductionMultiplier(100)).toBe(3);
    expect(getProductionMultiplier(1000)).toBe(21);
  });

  it("clamps negative/non-finite phd to a 1x multiplier", () => {
    expect(getProductionMultiplier(-5)).toBe(1);
    expect(getProductionMultiplier(NaN)).toBe(1);
  });
});

describe("getCostMultiplier", () => {
  it("known values, including the cap", () => {
    expect(getCostMultiplier(0)).toBe(1);
    expect(getCostMultiplier(1)).toBe(0.995);
    expect(getCostMultiplier(50)).toBe(0.75);
    expect(getCostMultiplier(99)).toBeCloseTo(0.505, 10);
    expect(getCostMultiplier(100)).toBe(0.5);
    expect(getCostMultiplier(101)).toBe(0.5);
    expect(getCostMultiplier(1000)).toBe(0.5);
    expect(getCostMultiplier(1_000_000)).toBe(0.5);
  });

  it("never leaves [0.5, 1] across a wide sweep", () => {
    for (let phd = 0; phd <= 500; phd += 5) {
      const m = getCostMultiplier(phd);
      expect(m).toBeGreaterThanOrEqual(0.5);
      expect(m).toBeLessThanOrEqual(1);
    }
  });

  it("clamps negative/non-finite phd to a 1x multiplier", () => {
    expect(getCostMultiplier(-5)).toBe(1);
    expect(getCostMultiplier(NaN)).toBe(1);
  });
});

describe("getTokensToNextPhd", () => {
  it("known values", () => {
    expect(getTokensToNextPhd(0)).toBe(1_000_000);
    expect(getTokensToNextPhd(1_000_000)).toBe(3_000_000);
    expect(getTokensToNextPhd(3_999_999)).toBe(1);
    expect(getTokensToNextPhd(4_000_000)).toBe(5_000_000);
  });

  it("is always positive", () => {
    for (const t of [0, 500_000, 1_000_000, 1e9, 1e15]) {
      expect(getTokensToNextPhd(t)).toBeGreaterThan(0);
    }
  });
});

describe("getPrestigeProgress", () => {
  it("known values", () => {
    expect(getPrestigeProgress(0)).toBe(0);
    expect(getPrestigeProgress(500_000)).toBe(0.5);
    expect(getPrestigeProgress(1_000_000)).toBe(0);
    expect(getPrestigeProgress(2_500_000)).toBe(0.5);
    expect(getPrestigeProgress(3_999_999)).toBeCloseTo(1, 5);
  });

  it("is always in [0, 1]", () => {
    for (const t of [0, 1, 999_999, 1_000_000, 2_500_000, 1e9, 1e15]) {
      const p = getPrestigeProgress(t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

// Shared by PrestigePanel.vue's "After: ..." line and
// PrestigeConfirmModal.vue's before/after table — both format these raw
// numbers differently, but must derive them from the exact same place.
describe("getPrestigeOutcome", () => {
  it("adds phdGain onto phdCount and runs both multipliers at the new total", () => {
    const outcome = getPrestigeOutcome(0, 2);
    expect(outcome.newPhdCount).toBe(2);
    expect(outcome.productionMultiplier).toBe(getProductionMultiplier(2));
    expect(outcome.costMultiplier).toBe(getCostMultiplier(2));
  });

  it("matches getProductionMultiplier/getCostMultiplier called directly at phdCount + phdGain", () => {
    const outcome = getPrestigeOutcome(5, 3);
    expect(outcome.newPhdCount).toBe(8);
    expect(outcome.productionMultiplier).toBeCloseTo(getProductionMultiplier(8), 10);
    expect(outcome.costMultiplier).toBeCloseTo(getCostMultiplier(8), 10);
  });

  it("phdGain of 0 leaves the outcome equal to the current phdCount", () => {
    const outcome = getPrestigeOutcome(4, 0);
    expect(outcome.newPhdCount).toBe(4);
    expect(outcome.productionMultiplier).toBe(getProductionMultiplier(4));
  });
});
