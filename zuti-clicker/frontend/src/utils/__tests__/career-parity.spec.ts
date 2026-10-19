import { describe, it, expect } from "vitest";
import {
  CAREER_NODES,
  getCareerModifiers,
  refundClosure,
  applyPhdGainBonus,
  keptUnitCount,
  costAtLevel,
  type CareerModifiers
} from "@/utils/careerCore";
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
} from "@/utils/careerEconomy";
import catalogFile from "./fixtures/career-catalog.json";
import vectorFile from "./fixtures/career-vectors.json";

// The frontend half of api/src/tests/career-parity.test.ts: the same
// byte-identical fixtures (written by api/scripts/generate-career-fixtures.ts),
// checked against THIS app's copy of careerCore.ts and its careerEconomy.ts
// mirror. A one-sided edit to either app's catalog or formulas fails here or
// there, never silently ships.
type Vector = { fn: string; args: unknown[]; expected: unknown };
const vectors = (vectorFile as unknown as { vectors: Vector[] }).vectors;
const nodeSets = (vectorFile as unknown as { nodeSets: Record<string, string[]> }).nodeSets;

function resolve(arg: unknown): unknown {
  if (arg && typeof arg === "object" && "set" in arg) {
    return getCareerModifiers(nodeSets[(arg as { set: string }).set]!);
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
      return costAtLevel(a[0]!);
    case "applyPhdGainBonus":
      return applyPhdGainBonus(a[0]!, a[1]!);
    case "keptUnitCount":
      return keptUnitCount(a[0]!, a[1]!);
    case "refundClosure":
      return refundClosure(a[0]!, a[1]!, a[2]!);
    case "getCareerPhdProductionMultiplier":
      return getCareerPhdProductionMultiplier(a[0]!, m(1));
    case "getCareerPhdCostMultiplier":
      return getCareerPhdCostMultiplier(a[0]!, m(1));
    case "getCareerUnitCostMultiplier":
      return getCareerUnitCostMultiplier(a[0]!, m(1), a[2]!);
    case "getWindfallGrant":
      return getWindfallGrant(a[0]!, a[1]!, m(2));
    case "getCareerProductionMultiplier":
      return getCareerProductionMultiplier(m(0));
    case "getCareerBaseTps":
      return getCareerBaseTps(a[0]!, m(1));
    case "getCareerUpgradeCost":
      return getCareerUpgradeCost(a[0]!, m(1));
    case "getCareerClickSynergy":
      return getCareerClickSynergy(a[0]!, m(1));
    case "getBoosterEffectMultiplier":
      return getBoosterEffectMultiplier(a[0]!, m(1));
    case "getMaxBoosterMultiplier":
      return getMaxBoosterMultiplier(a[0]!, m(1));
    default:
      throw new Error(`unknown vector fn ${fn}`);
  }
}

describe("Academic Career parity (shared golden fixtures)", () => {
  it("the expanded catalog matches the shared snapshot exactly", () => {
    expect(JSON.parse(JSON.stringify(CAREER_NODES))).toEqual(
      (catalogFile as unknown as { nodes: unknown[] }).nodes
    );
  });

  it.each(vectors.map((v, i) => [i, v.fn, v] as const))(
    "vector %i (%s) reproduces exactly",
    (_i, _fn, v) => {
      expect(JSON.parse(JSON.stringify(call(v.fn, v.args)))).toEqual(v.expected);
    }
  );

  it("hand-computed: prices x1.68/level rounded up, gain bonus floors exactly", () => {
    expect([0, 1, 2, 3, 4].map(costAtLevel)).toEqual([1, 2, 4, 7, 12]);
    expect(applyPhdGainBonus(20, 1500)).toBe(23); // not 22.999... -> 22
    expect(keptUnitCount(7, 2500)).toBe(1);
  });
});
