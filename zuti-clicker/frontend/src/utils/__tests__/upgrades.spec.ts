import { describe, it, expect } from "vitest";
import {
  getFlatClickBonus,
  getClickMultiplier,
  getClickSynergy,
  getCritChance,
  getCritMultiplier,
  getBoosterDurationMultiplier,
  getBoosterSpawnMultiplier,
  getActiveBoosterMultiplier,
  getClickValue,
  rollCrit,
  pickWeightedBoosterId,
  getUpgradeEffectLabel,
  bestCritTier
} from "@/utils/upgrades";
import { BOOSTER_DEFINITIONS, UPGRADE_DEFINITIONS } from "@/utils/gameConstants";
import { formatPercent } from "@/utils/formatters";
import type { ActiveBoosterState } from "@/types";

function upgradeDef(id: string) {
  return UPGRADE_DEFINITIONS.find((d) => d.id === id)!;
}

describe("getFlatClickBonus", () => {
  it("is 0 with nothing owned", () => {
    expect(getFlatClickBonus([])).toBe(0);
  });

  it("sums owned flat tiers, ignoring other families", () => {
    expect(getFlatClickBonus(["chalk"])).toBe(1);
    expect(getFlatClickBonus(["chalk", "redPen"])).toBe(5);
    expect(getFlatClickBonus(["chalk", "redPen", "laserPointer", "overheadProjector"])).toBe(125);
    expect(getFlatClickBonus(["chalk", "firmHandshake"])).toBe(1);
  });

  it("ignores unknown ids", () => {
    expect(getFlatClickBonus(["not-a-real-upgrade"])).toBe(0);
  });
});

describe("getClickMultiplier", () => {
  it("is 1x with nothing owned", () => {
    expect(getClickMultiplier([])).toBe(1);
  });

  it("multiplies owned multiplier tiers (x2 each)", () => {
    expect(getClickMultiplier(["firmHandshake"])).toBe(2);
    expect(getClickMultiplier(["firmHandshake", "morningCoffee"])).toBe(4);
    expect(
      getClickMultiplier([
        "firmHandshake",
        "morningCoffee",
        "officeHours",
        "tenure",
        "honoraryDegree"
      ])
    ).toBe(32);
  });
});

describe("getClickSynergy", () => {
  it("is 0 with nothing owned, and sums to the documented 3% cap when all owned", () => {
    expect(getClickSynergy([])).toBe(0);
    const allSynergy = ["lectureNotes", "seminarRoom", "researchGrant", "facultyBoard"];
    expect(getClickSynergy(allSynergy)).toBeCloseTo(0.03, 10);
  });

  // Regression guard: a 0.5%-step value must never be displayed via
  // Math.round (CLAUDE.md) — formatPercent must show "0.5", not "1".
  it("a single half-percent tier displays as 0.5, not 1 (Math.round regression)", () => {
    const synergy = getClickSynergy(["lectureNotes"]);
    expect(synergy).toBeCloseTo(0.005, 10);
    expect(formatPercent(synergy * 100)).toBe("0.5");
  });
});

describe("crit tiers (do not stack — highest-cost owned tier wins)", () => {
  it("no crit upgrades -> 0 chance, 1x multiplier", () => {
    expect(getCritChance([])).toBe(0);
    expect(getCritMultiplier([])).toBe(1);
  });

  it("a single tier applies its own chance/multiplier", () => {
    expect(getCritChance(["luckyGuess"])).toBe(0.05);
    expect(getCritMultiplier(["luckyGuess"])).toBe(3);
  });

  it("owning a lower and a higher tier applies only the higher tier's values", () => {
    expect(getCritChance(["luckyGuess", "peerReview"])).toBe(0.15);
    expect(getCritMultiplier(["luckyGuess", "peerReview"])).toBe(7);
  });

  it("owning all three tiers still applies only the best (peerReview)", () => {
    const all = ["luckyGuess", "openBookExam", "peerReview"];
    expect(getCritChance(all)).toBe(0.15);
    expect(getCritMultiplier(all)).toBe(7);
  });
});

describe("booster-system perk multipliers", () => {
  it("default to 1x with nothing owned", () => {
    expect(getBoosterDurationMultiplier([])).toBe(1);
    expect(getBoosterSpawnMultiplier([])).toBe(1);
  });

  it("apply their documented bonus when owned", () => {
    expect(getBoosterDurationMultiplier(["conferenceBadge"])).toBeCloseTo(1.3, 10);
    expect(getBoosterSpawnMultiplier(["departmentNewsletter"])).toBeCloseTo(1 + 1 / 3, 10);
  });

  it("are independent of each other and of click upgrades", () => {
    expect(getBoosterDurationMultiplier(["departmentNewsletter", "chalk"])).toBe(1);
    expect(getBoosterSpawnMultiplier(["conferenceBadge", "chalk"])).toBe(1);
  });
});

describe("getActiveBoosterMultiplier", () => {
  const now = 1_000_000;

  it("is 1x (neutral) with no active boosters", () => {
    expect(getActiveBoosterMultiplier([], now, "production")).toBe(1);
    expect(getActiveBoosterMultiplier([], now, "costReduction")).toBe(1);
  });

  it("applies an active booster's multiplier for its own kind only", () => {
    const active: ActiveBoosterState[] = [{ id: "frenzy", expiresAt: now + 1000 }];
    expect(getActiveBoosterMultiplier(active, now, "production")).toBe(7);
    expect(getActiveBoosterMultiplier(active, now, "click")).toBe(1);
  });

  it("costReduction is expressed as a discount, not the raw stored fraction", () => {
    const active: ActiveBoosterState[] = [{ id: "clearance", expiresAt: now + 1000 }];
    expect(getActiveBoosterMultiplier(active, now, "costReduction")).toBeCloseTo(0.75, 10);
  });

  it("excludes an expired booster", () => {
    const active: ActiveBoosterState[] = [{ id: "frenzy", expiresAt: now - 1 }];
    expect(getActiveBoosterMultiplier(active, now, "production")).toBe(1);
  });

  it("stacks multiple simultaneously active boosters of different kinds independently", () => {
    const active: ActiveBoosterState[] = [
      { id: "frenzy", expiresAt: now + 1000 },
      { id: "clickStorm", expiresAt: now + 1000 },
      { id: "clearance", expiresAt: now + 1000 }
    ];
    expect(getActiveBoosterMultiplier(active, now, "production")).toBe(7);
    expect(getActiveBoosterMultiplier(active, now, "click")).toBe(10);
    expect(getActiveBoosterMultiplier(active, now, "costReduction")).toBeCloseTo(0.75, 10);
  });

  it("ignores an unknown booster id", () => {
    const active: ActiveBoosterState[] = [{ id: "not-a-real-booster", expiresAt: now + 1000 }];
    expect(getActiveBoosterMultiplier(active, now, "production")).toBe(1);
  });
});

describe("getClickValue", () => {
  it("with no upgrades and 0 phd/tokens-per-second, equals the base click", () => {
    const value = getClickValue({
      flatClickBonus: 0,
      clickMultiplier: 1,
      phdProductionMultiplier: 1,
      tokensPerSecond: 0,
      clickSynergy: 0,
      boosterClickMultiplier: 1
    });
    expect(value).toBe(1);
  });

  it("applies flat bonus, then multiplier, then PhD bonus, in that order", () => {
    // (1 + 4) * 2 * 1.1 = 11
    const value = getClickValue({
      flatClickBonus: 4,
      clickMultiplier: 2,
      phdProductionMultiplier: 1.1,
      tokensPerSecond: 0,
      clickSynergy: 0,
      boosterClickMultiplier: 1
    });
    expect(value).toBeCloseTo(11, 10);
  });

  it("adds a synergy slice of tokens/sec before the booster multiplier", () => {
    // basePart = 1, synergy slice = 1000 * 0.03 = 30 -> 31, then x2 booster
    const value = getClickValue({
      flatClickBonus: 0,
      clickMultiplier: 1,
      phdProductionMultiplier: 1,
      tokensPerSecond: 1000,
      clickSynergy: 0.03,
      boosterClickMultiplier: 2
    });
    expect(value).toBeCloseTo(62, 10);
  });
});

describe("rollCrit", () => {
  it("never crits at 0 chance regardless of roll", () => {
    expect(rollCrit(0, () => 0)).toBe(false);
  });

  it("crits when the roll lands below the chance", () => {
    expect(rollCrit(0.5, () => 0.49)).toBe(true);
    expect(rollCrit(0.5, () => 0.5)).toBe(false);
    expect(rollCrit(0.5, () => 0.51)).toBe(false);
  });

  it("always crits at 100% chance except an exact 1.0 roll", () => {
    expect(rollCrit(1, () => 0.999999)).toBe(true);
    expect(rollCrit(1, () => 0)).toBe(true);
  });
});

describe("pickWeightedBoosterId", () => {
  const totalWeight = BOOSTER_DEFINITIONS.reduce((sum, d) => sum + d.weight, 0);

  it("picks the first definition at roll 0", () => {
    expect(pickWeightedBoosterId(() => 0)).toBe(BOOSTER_DEFINITIONS[0]!.id);
  });

  it("picks the last definition just under the top of the weight range", () => {
    expect(pickWeightedBoosterId(() => (totalWeight - 0.001) / totalWeight)).toBe(
      BOOSTER_DEFINITIONS[BOOSTER_DEFINITIONS.length - 1]!.id
    );
  });

  it("always returns a known booster id across a dense sweep of [0, 1)", () => {
    const knownIds = new Set(BOOSTER_DEFINITIONS.map((d) => d.id));
    for (let i = 0; i < 1000; i++) {
      const roll = i / 1000;
      expect(knownIds.has(pickWeightedBoosterId(() => roll))).toBe(true);
    }
  });
});

describe("getUpgradeEffectLabel", () => {
  it("flat: +N", () => {
    expect(getUpgradeEffectLabel(upgradeDef("chalk"))).toBe("+1");
  });

  it("multiplier: ×N", () => {
    expect(getUpgradeEffectLabel(upgradeDef("firmHandshake"))).toBe("×2");
  });

  it("crit: chance% ×multiplier", () => {
    expect(getUpgradeEffectLabel(upgradeDef("luckyGuess"))).toBe("5% ×3");
  });

  // Half-percent regression, shared by UpgradeTile.vue's buy grid AND the
  // owned strip via this one function — formatPercent, never Math.round.
  it("synergy: a half-percent tier displays as 0.5%, not 1% (Math.round regression)", () => {
    expect(getUpgradeEffectLabel(upgradeDef("lectureNotes"))).toBe("+0.5%");
  });

  it("boosterDuration/boosterSpawn: +N%", () => {
    expect(getUpgradeEffectLabel(upgradeDef("conferenceBadge"))).toBe("+30%");
    expect(getUpgradeEffectLabel(upgradeDef("departmentNewsletter"))).toBe("+33.3%");
  });
});

describe("bestCritTier", () => {
  it("undefined with no crit tier owned", () => {
    expect(bestCritTier([])).toBeUndefined();
  });

  it("the highest-cost owned tier wins when multiple are owned", () => {
    expect(bestCritTier(["luckyGuess", "peerReview"])?.id).toBe("peerReview");
  });
});
