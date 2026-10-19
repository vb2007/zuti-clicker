import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import {
  CAREER_NODES,
  CAREER_NODES_BY_ID,
  CAREER_ROOT_ID,
  CAREER_CAPS,
  getCareerModifiers,
  refundClosure,
  applyPhdGainBonus,
  keptUnitCount,
  costAtLevel,
  careerBuyRefusal,
  isKnownCareerNodeId,
  type CareerModifiers
} from "../services/careerCore.js";
import {
  getCareerPhdProductionMultiplier,
  getCareerPhdCostMultiplier,
  getCareerProductionMultiplier,
  getCareerBaseTps,
  getCareerUnitCostMultiplier,
  getCareerUpgradeCost,
  getCareerClickSynergy,
  getBoosterEffectMultiplier,
  getMaxBoosterMultiplier,
  getWindfallGrant
} from "../services/economy.js";
import { PHD_TOKEN_SCALE } from "../constants/gameBalance.js";

// Pure unit tests — no live server or database. The other half of these is
// frontend/src/utils/__tests__/career-parity.spec.ts: the same byte-identical
// fixtures, checked against the client's own copy of careerCore.ts and its
// utils/careerEconomy.ts mirror, so the two apps can never silently disagree
// about a price, a prerequisite or how much the tree is worth.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const read = (name: string) =>
  JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf-8")) as Record<
    string,
    unknown
  >;
const catalogFixture = read("career-catalog.json") as { nodes: unknown[] };
const vectorFixture = read("career-vectors.json") as {
  nodeSets: Record<string, string[]>;
  vectors: { fn: string; args: unknown[]; expected: unknown }[];
};

function resolve(arg: unknown): unknown {
  if (arg && typeof arg === "object" && "set" in arg) {
    return getCareerModifiers(vectorFixture.nodeSets[(arg as { set: string }).set]!);
  }
  return arg;
}

function call(fn: string, raw: unknown[]): unknown {
  const a = raw.map(resolve) as never[];
  const m = (i: number) => a[i] as unknown as CareerModifiers;
  switch (fn) {
    case "getCareerModifiers":
      return m(0);
    case "costAtLevel":
      return costAtLevel(a[0]);
    case "applyPhdGainBonus":
      return applyPhdGainBonus(a[0], a[1]);
    case "keptUnitCount":
      return keptUnitCount(a[0], a[1]);
    case "refundClosure":
      return refundClosure(a[0], a[1], a[2]);
    case "getCareerPhdProductionMultiplier":
      return getCareerPhdProductionMultiplier(a[0], m(1));
    case "getCareerPhdCostMultiplier":
      return getCareerPhdCostMultiplier(a[0], m(1));
    case "getCareerUnitCostMultiplier":
      return getCareerUnitCostMultiplier(a[0], m(1), a[2]);
    case "getWindfallGrant":
      return getWindfallGrant(a[0], a[1], m(2));
    case "getCareerProductionMultiplier":
      return getCareerProductionMultiplier(m(0));
    case "getCareerBaseTps":
      return getCareerBaseTps(a[0], m(1));
    case "getCareerUpgradeCost":
      return getCareerUpgradeCost(a[0], m(1));
    case "getCareerClickSynergy":
      return getCareerClickSynergy(a[0], m(1));
    case "getBoosterEffectMultiplier":
      return getBoosterEffectMultiplier(a[0], m(1));
    case "getMaxBoosterMultiplier":
      return getMaxBoosterMultiplier(a[0], m(1));
    default:
      throw new Error(`unknown vector fn ${fn}`);
  }
}

describe("Academic Career parity (shared golden fixtures)", () => {
  it("the expanded catalog matches the shared snapshot exactly", () => {
    // JSON round-trip drops `undefined` keys the same way the fixture did.
    expect(JSON.parse(JSON.stringify(CAREER_NODES))).toEqual(catalogFixture.nodes);
  });

  it.each(vectorFixture.vectors.map((v, i) => [i, v.fn, v] as const))(
    "vector %i (%s) reproduces exactly",
    (_i, _fn, v) => {
      expect(JSON.parse(JSON.stringify(call(v.fn, v.args)))).toEqual(v.expected);
    }
  );

  it("is independent of input order and ignores unknown ids", () => {
    const sets = vectorFixture.nodeSets;
    expect(getCareerModifiers(sets["mixedShuffled"]!)).toEqual(getCareerModifiers(sets["mixed"]!));
  });
});

// Hand-computed — the fixtures are generated from this implementation, so a
// bug in it would be copied into them; these pin the arithmetic itself.
describe("Academic Career arithmetic (hand-computed)", () => {
  it("prices grow x1.68 per level, rounded up, in integers", () => {
    // 1 -> ceil(1.68)=2 -> ceil(3.36)=4 -> ceil(6.72)=7 -> ceil(11.76)=12
    expect([0, 1, 2, 3, 4].map(costAtLevel)).toEqual([1, 2, 4, 7, 12]);
  });

  it("scales PhD gain by a bonus with an exact floor (20 x 1.15 = 23, not 22)", () => {
    expect(applyPhdGainBonus(20, 1500)).toBe(23);
    expect(applyPhdGainBonus(7, 3300)).toBe(9); // 9.31
    expect(applyPhdGainBonus(0, 9700)).toBe(0); // no base PhD, no bonus
  });

  it("keeps floor(owned x share) units", () => {
    expect(keptUnitCount(7, 2500)).toBe(1); // 1.75
    expect(keptUnitCount(40, 500)).toBe(2);
    expect(keptUnitCount(399, 2000)).toBe(79); // 79.8
  });

  it("stacks booster potency onto the bonus part only", () => {
    const mods = getCareerModifiers([
      "habilitation",
      "conferences.conferenceSeason",
      "conferences.frenzyPotency.1"
    ]);
    // frenzy x7 at +10% potency: 1 + 6 x 1.1 = 7.6
    expect(getBoosterEffectMultiplier("frenzy", mods)).toBeCloseTo(7.6, 12);
  });
});

describe("Academic Career catalog invariants", () => {
  it("has ~250 nodes with unique ids that fit CareerNodeSave.nodeId (VARCHAR(32))", () => {
    expect(CAREER_NODES.length).toBeGreaterThanOrEqual(240);
    expect(new Set(CAREER_NODES.map((n) => n.id)).size).toBe(CAREER_NODES.length);
    for (const n of CAREER_NODES) expect(n.id.length).toBeLessThanOrEqual(32);
  });

  it("is one tree: a single root, every parent listed before its child", () => {
    const seen = new Set<string>();
    const roots = CAREER_NODES.filter((n) => n.parent === null);
    expect(roots.map((n) => n.id)).toEqual([CAREER_ROOT_ID]);
    for (const n of CAREER_NODES) {
      if (n.parent !== null) expect(seen.has(n.parent)).toBe(true);
      seen.add(n.id);
    }
  });

  it("prices are positive integers, the root costs 1 and the whole tree fits an INT column", () => {
    for (const n of CAREER_NODES) {
      expect(Number.isInteger(n.cost)).toBe(true);
      expect(n.cost).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(n.value)).toBe(true);
    }
    expect(CAREER_NODES_BY_ID.get(CAREER_ROOT_ID)!.cost).toBe(1);
    expect(CAREER_NODES.reduce((s, n) => s + n.cost, 0)).toBeLessThan(2147483647);
  });

  it("every cap holds with the whole tree owned", () => {
    const m = getCareerModifiers(CAREER_NODES.map((n) => n.id));
    expect(m.unitCostDiscount).toBeLessThanOrEqual(CAREER_CAPS.unitCostDiscount);
    expect(m.upgradeCostDiscount).toBeLessThanOrEqual(CAREER_CAPS.upgradeCostDiscount);
    expect(m.critChanceAdd).toBeLessThanOrEqual(CAREER_CAPS.critChance);
    expect(m.keepUnitsBp).toBeLessThanOrEqual(CAREER_CAPS.keepUnitsBp);
    expect(m.startingTokens).toBeLessThanOrEqual(CAREER_CAPS.startingTokens);
    expect(CAREER_CAPS.startingTokens).toBeLessThanOrEqual(PHD_TOKEN_SCALE);
    expect(m.phdCostCapAdd).toBeLessThanOrEqual(CAREER_CAPS.phdCostCapAdd);
    expect(m.autoClickRate).toBeLessThanOrEqual(CAREER_CAPS.autoClickRate);
    expect(getCareerClickSynergy(0.03, m)).toBeLessThanOrEqual(CAREER_CAPS.totalClickSynergy);
    expect(1 - getBoosterEffectMultiplier("clearance", m)).toBeLessThanOrEqual(
      CAREER_CAPS.clearanceDiscount
    );
    // The cheapest anything can ever cost (max PhDs, whole tree, max
    // clearance) stays at or above the floor — the floor is a safety net
    // that today's catalog never even reaches.
    const cheapest = getCareerUnitCostMultiplier(
      1e9,
      m,
      getMaxBoosterMultiplier("costReduction", m)
    );
    expect(cheapest).toBeGreaterThanOrEqual(CAREER_CAPS.costMultiplierFloor);
    expect(m.keepUpgradeFamilies.sort()).toEqual([
      "booster",
      "crit",
      "flat",
      "multiplier",
      "synergy"
    ]);
    expect(m.unlockedBoosters.sort()).toEqual(["critStorm", "windfall"]);
  });
});

describe("Academic Career purchase rules", () => {
  it("refuses unknown, owned, orphaned and unaffordable nodes, in that order", () => {
    expect(careerBuyRefusal("nope", [], 999)).toBe("unknown");
    expect(careerBuyRefusal("habilitation", ["habilitation"], 999)).toBe("already_owned");
    expect(careerBuyRefusal("research.labAccess", [], 999)).toBe("prerequisite_missing");
    expect(careerBuyRefusal("habilitation", [], 0)).toBe("insufficient_phd");
    expect(careerBuyRefusal("habilitation", [], 1)).toBeNull();
  });

  it("looks ids up without touching Object.prototype", () => {
    for (const id of ["__proto__", "toString", "constructor", "hasOwnProperty"]) {
      expect(isKnownCareerNodeId(id)).toBe(false);
    }
    expect(isKnownCareerNodeId(42)).toBe(false);
  });

  it("refunds cascade to every owned descendant, never to a permanent one", () => {
    const owned = [
      "habilitation",
      "research.labAccess",
      "research.grantWriting.1",
      "lecturing.lecturer"
    ];
    expect(refundClosure("research.labAccess", owned, owned)).toEqual([
      "research.labAccess",
      "research.grantWriting.1"
    ]);
    // grantWriting.1 is from an earlier window -> its parent can't be refunded.
    expect(refundClosure("research.labAccess", owned, ["research.labAccess"])).toBeNull();
    expect(refundClosure("research.institute", owned, owned)).toBeNull(); // not owned
  });
});
