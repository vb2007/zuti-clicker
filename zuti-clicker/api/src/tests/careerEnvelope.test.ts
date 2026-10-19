import { describe, it, expect } from "@jest/globals";
import {
  evaluateSaveEnvelope,
  type PrevSaveSnapshot,
  type IncomingSave
} from "../services/saveValidator.js";
import { emptyCareerModifiers, type CareerModifiers } from "../services/careerCore.js";
import { getBulkCost } from "../services/economy.js";
import {
  PHD_TOKEN_SCALE,
  MAX_PRODUCTION_BOOSTER_MULTIPLIER,
  getUnitDefinition
} from "../constants/gameBalance.js";
import { CLOCK_GRACE_SECS, EARNED_ACCEPT_MARGIN } from "../constants/antiCheat.js";

// Pure unit tests for how the Academic Career tree widens the save
// plausibility envelope (services/saveValidator.ts). Every case is checked
// BOTH ways — with the modifier the honest save passes, without it the very
// same save is clamped or rejected — so each test proves the modifier is what
// makes the difference, not some unrelated slack.

const NOW = new Date("2026-01-01T00:00:10.000Z");
const USER_CREATED_AT = new Date("2025-01-01T00:00:00.000Z");
// 1 s since the previous save, plus the clock grace the envelope always adds.
const PREV_SAVED_AT = new Date(NOW.getTime() - 1000);
const DT = 1 + CLOCK_GRACE_SECS;

function mods(overrides: Partial<CareerModifiers>): CareerModifiers {
  return { ...emptyCareerModifiers(), ...overrides };
}

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
    savedAt: PREV_SAVED_AT,
    units: [],
    upgrades: [],
    ...overrides
  };
}

// A resync of `prev` (no clicks, no time beyond the interval) with overrides.
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

const verdict = (prev: PrevSaveSnapshot, incoming: IncomingSave) =>
  evaluateSaveEnvelope(prev, USER_CREATED_AT, NOW, incoming);

describe("career envelope — production and income", () => {
  // 100 alpha (0.3/s each) at the maximum production booster.
  const units = [{ unitId: "alpha", owned: 100 }];
  const baseBound = 100 * 0.3 * MAX_PRODUCTION_BOOSTER_MULTIPLIER * DT * EARNED_ACCEPT_MARGIN;

  it("a production multiplier node raises the earnings bound by exactly its factor", () => {
    const earned = baseBound * 1.9; // over the base bound, under its 2x reject line
    const withTree = prevSave({ units, career: mods({ productionMult: 2 }) });
    const without = prevSave({ units });
    const save = (p: PrevSaveSnapshot) =>
      next(p, { totalTokensEarned: p.totalTokensEarned + earned, tokens: earned });

    expect(verdict(withTree, save(withTree)).outcome).toBe("accept");
    expect(verdict(without, save(without)).outcome).toBe("clamp");
    // ...and the multiplier is honoured exactly, not loosely: 2.1x the base is over 2x.
    const over = next(withTree, {
      totalTokensEarned: withTree.totalTokensEarned + baseBound * 2.1,
      tokens: baseBound * 2.1
    });
    expect(verdict(withTree, over).outcome).toBe("clamp");
  });

  it("per-unit and per-PhD production nodes count too", () => {
    const earned = baseBound * 2.5; // past the base 2x reject line
    const unitTree = prevSave({ units, career: mods({ unitProductionMult: { alpha: 3 } }) });
    expect(
      verdict(unitTree, next(unitTree, { totalTokensEarned: 3_000_000 + earned, tokens: earned }))
        .outcome
    ).toBe("accept");
    const wrongUnit = prevSave({ units, career: mods({ unitProductionMult: { beta: 3 } }) });
    expect(
      verdict(wrongUnit, next(wrongUnit, { totalTokensEarned: 3_000_000 + earned, tokens: earned }))
        .outcome
    ).toBe("reject");
  });

  it("booster potency widens the production booster maximum", () => {
    // frenzy x7 at +50% potency is 1 + 6 x 1.5 = x10.
    const earned = baseBound * (10 / 7) * 0.99;
    const potent = prevSave({ units, career: mods({ boosterPotency: { frenzy: 0.5 } }) });
    const plain = prevSave({ units });
    const save = (p: PrevSaveSnapshot) =>
      next(p, { totalTokensEarned: p.totalTokensEarned + earned, tokens: earned });
    expect(verdict(potent, save(potent)).outcome).toBe("accept");
    expect(verdict(plain, save(plain)).outcome).toBe("clamp");
  });

  it("Teaching Assistant auto-clicks are bounded by time, not by the clicks bound", () => {
    // No units, no clicks: only the auto-click income can explain any earnings.
    // An auto-click is worth the base click (1) x the max production booster.
    const rate = 10;
    const autoBound = rate * 1 * MAX_PRODUCTION_BOOSTER_MULTIPLIER * DT * EARNED_ACCEPT_MARGIN;
    const earned = autoBound * 0.9;
    const ta = prevSave({ career: mods({ autoClickRate: rate }) });
    const plain = prevSave();
    const save = (p: PrevSaveSnapshot) =>
      next(p, { totalTokensEarned: p.totalTokensEarned + earned, tokens: earned });
    expect(verdict(ta, save(ta)).outcome).toBe("accept");
    expect(verdict(plain, save(plain)).outcome).toBe("reject");

    // The clicks bound itself is unchanged: auto-clicks never enter totalClicks.
    const clicks = (p: PrevSaveSnapshot) => next(p, { totalClicks: p.totalClicks + 1e9 });
    expect(verdict(ta, clicks(ta)).outcome).toBe("reject");
  });
});

describe("career envelope — prices", () => {
  it("unit and upgrade discounts lower the minimum spend an honest purchase is checked against", () => {
    const alpha = getUnitDefinition("alpha")!;
    // 10 alpha paid at clearance (-25%) and a -30% tree discount.
    const paid = getBulkCost(alpha, 0, 10, 0.75 * 0.7);
    const build = (career: CareerModifiers) => {
      const p = prevSave({ tokens: 1000, career });
      return [
        p,
        next(p, { tokens: 1000 - paid, units: [{ unitId: "alpha", owned: 10 }] })
      ] as const;
    };
    const [discounted, save1] = build(mods({ unitCostDiscount: 0.3 }));
    const [plain, save2] = build(emptyCareerModifiers());
    expect(verdict(discounted, save1).outcome).toBe("accept");
    expect(verdict(plain, save2).outcome).toBe("clamp");

    // chalk (150) at a -40% upgrade discount and the clearance multiplier.
    const upgradePaid = 150 * 0.6 * 0.75;
    const withUpgrade = (career: CareerModifiers) => {
      const p = prevSave({ tokens: 1000, career });
      return [p, next(p, { tokens: 1000 - upgradePaid, upgrades: ["chalk"] })] as const;
    };
    const [u1, s1] = withUpgrade(mods({ upgradeCostDiscount: 0.4 }));
    const [u2, s2] = withUpgrade(emptyCareerModifiers());
    expect(verdict(u1, s1).outcome).toBe("accept");
    expect(verdict(u2, s2).outcome).toBe("clamp");
  });
});

describe("career envelope — what a prestige keeps", () => {
  // A prestige inside the interval: 0 -> 1, from a run that owned 200 alpha.
  function prestigedFrom(
    career: CareerModifiers,
    overrides: Partial<PrevSaveSnapshot> = {},
    incoming: Partial<IncomingSave> = {}
  ) {
    const prev = prevSave({
      prestigeCount: 0,
      totalTokensEarned: 2_000_000,
      units: [{ unitId: "alpha", owned: 200 }],
      career,
      ...overrides
    });
    return [prev, next(prev, { prestigeCount: 1, phdCount: 1, tokens: 0, ...incoming })] as const;
  }

  it("regression: units kept by Tenure are not mistaken for units bought for free", () => {
    const keptSave = { units: [{ unitId: "alpha", owned: 50 }] };
    const [kept, save] = prestigedFrom(mods({ keepUnitsBp: 2500 }), {}, keptSave);
    expect(verdict(kept, save).outcome).toBe("accept");

    // Without the node the same 50 alpha would have had to be bought from 0.
    const [plain, plainSave] = prestigedFrom(emptyCareerModifiers(), {}, keptSave);
    const v = verdict(plain, plainSave);
    expect(v.outcome).toBe("reject");
    if (v.outcome === "reject") expect(v.reason).toBe("spend_exceeds_available_budget");

    // Keeping is floor(owned x share) — one unit more than that is still a purchase.
    const [kept2, overSave] = prestigedFrom(
      mods({ keepUnitsBp: 2500 }),
      {},
      {
        units: [{ unitId: "alpha", owned: 51 }]
      }
    );
    expect(verdict(kept2, overSave).outcome).toBe("reject");
  });

  it("upgrade families kept by Endowment/Archives are free after a prestige", () => {
    const upgrades = { upgrades: ["chalk", "redPen"] };
    const [kept, save] = prestigedFrom(
      mods({ keepUpgradeFamilies: ["flat"] }),
      { units: [], ...upgrades },
      { units: [], ...upgrades }
    );
    expect(verdict(kept, save).outcome).toBe("accept");
    const [plain, plainSave] = prestigedFrom(
      emptyCareerModifiers(),
      { units: [], ...upgrades },
      { units: [], ...upgrades }
    );
    expect(verdict(plain, plainSave).outcome).toBe("reject");
    // Keeping "flat" doesn't keep a multiplier-family upgrade.
    const [wrong, wrongSave] = prestigedFrom(
      mods({ keepUpgradeFamilies: ["flat"] }),
      { units: [], upgrades: ["firmHandshake"] },
      { units: [], upgrades: ["firmHandshake"] }
    );
    expect(verdict(wrong, wrongSave).outcome).toBe("reject");
  });

  it("the start fund is spendable money after a prestige, but only once per prestige the earnings explain", () => {
    const fund = 1000;
    const [funded, save] = prestigedFrom(
      mods({ startingTokens: fund }),
      { units: [] },
      {
        units: [],
        tokens: fund
      }
    );
    expect(verdict(funded, save).outcome).toBe("accept");
    const [plain, plainSave] = prestigedFrom(
      emptyCareerModifiers(),
      { units: [] },
      {
        units: [],
        tokens: fund
      }
    );
    expect(verdict(plain, plainSave).outcome).not.toBe("accept");

    // A forged prestigeCount can't multiply the fund: with no earnings in the
    // interval at most one fund is explained, however many prestiges are claimed.
    const [forged, forgedSave] = prestigedFrom(
      mods({ startingTokens: fund }),
      { units: [] },
      {
        units: [],
        prestigeCount: 50,
        tokens: fund * 50
      }
    );
    expect(verdict(forged, forgedSave).outcome).toBe("reject");
  });
});

describe("career envelope — the PhD bound", () => {
  // 20 prestiges over 20 x SCALE tokens: the prestige-only bound is 21.
  const n = 20;
  const prevFor = (overrides: Partial<PrevSaveSnapshot>) =>
    prevSave({ prestigeCount: n, totalTokensEarned: n * PHD_TOKEN_SCALE, ...overrides });

  it("a PhD-gain bonus scales what prestige can explain", () => {
    // +50%: 1.5 x 20 + 1 = 31.
    const bonus = prevFor({ phdCount: 31, career: mods({ phdGainBp: 5000 }) });
    expect(verdict(bonus, next(bonus)).outcome).toBe("accept");
    const plain = prevFor({ phdCount: 31 });
    expect(verdict(plain, next(plain)).outcome).toBe("clamp");
  });

  it("regression: PhDs invested in the tree can't be restored through a save", () => {
    // 21 earned, 15 of them invested: 6 held.
    const prev = prevFor({ phdCount: 6, phdInvested: 15 });
    expect(verdict(prev, next(prev)).outcome).toBe("accept");
    const restored = verdict(prev, next(prev, { phdCount: 21 }));
    expect(restored.outcome).toBe("reject");
    if (restored.outcome === "reject") expect(restored.reason).toBe("phd_exceeds_max_possible");
    // ...whereas without the investment the same 21 is fine.
    const notInvested = prevFor({ phdCount: 6 });
    expect(verdict(notInvested, next(notInvested, { phdCount: 21 })).outcome).toBe("accept");
  });

  it("a first-ever save has no tree: the plain bounds apply", () => {
    const v = evaluateSaveEnvelope(null, USER_CREATED_AT, NOW, {
      tokens: 0,
      totalTokensEarned: n * PHD_TOKEN_SCALE,
      totalClicks: 30_000,
      elapsedSeconds: 500,
      phdCount: 31,
      prestigeCount: n,
      units: [],
      upgrades: []
    });
    expect(v.outcome).toBe("clamp");
  });
});
