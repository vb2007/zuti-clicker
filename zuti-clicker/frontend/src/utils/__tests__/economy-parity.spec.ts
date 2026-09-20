import { describe, it, expect } from "vitest";
import { getUnitCost, getBulkCost } from "@/utils/costCalculator";
import { getPhdGain, getProductionMultiplier, getCostMultiplier } from "@/utils/prestige";
import {
  getFlatClickBonus,
  getClickMultiplier,
  getClickSynergy,
  getClickValue,
  type ClickValueParams
} from "@/utils/upgrades";
import { UNIT_DEFINITIONS } from "@/utils/gameConstants";
import vectorFile from "./fixtures/economy-vectors.json";

// Vitest/Vite import JSON modules natively, unlike ts-jest's ESM transform on
// the api side — see api/src/tests/economy-parity.test.ts, the other half of
// this pair, which reads the identical file via fs instead. Same vectors,
// checked here against the frontend's own formulas — this is what catches
// api/src/services/economy.ts silently drifting from this file's mirrors.
type Vector = { fn: string; args: unknown[]; expected: number };
const vectors = (vectorFile as { vectors: Vector[] }).vectors;

const unitsById = new Map(UNIT_DEFINITIONS.map((u) => [u.id, u]));

function resolveUnitArg(arg: unknown) {
  if (typeof arg === "string" && unitsById.has(arg)) return unitsById.get(arg)!;
  return arg;
}

function call(fn: string, args: unknown[]): number {
  const resolved = args.map(resolveUnitArg);
  switch (fn) {
    case "getUnitCost":
      return getUnitCost(resolved[0] as never, resolved[1] as number, resolved[2] as number);
    case "getBulkCost":
      return getBulkCost(
        resolved[0] as never,
        resolved[1] as number,
        resolved[2] as number,
        resolved[3] as number
      );
    case "getPhdGain":
      return getPhdGain(resolved[0] as number);
    case "getProductionMultiplier":
      return getProductionMultiplier(resolved[0] as number);
    case "getCostMultiplier":
      return getCostMultiplier(resolved[0] as number);
    case "getFlatClickBonus":
      return getFlatClickBonus(resolved[0] as string[]);
    case "getClickMultiplier":
      return getClickMultiplier(resolved[0] as string[]);
    case "getClickSynergy":
      return getClickSynergy(resolved[0] as string[]);
    case "getClickValue":
      return getClickValue(resolved[0] as ClickValueParams);
    default:
      throw new Error(`Unknown vector function: ${fn}`);
  }
}

describe("economy parity (frontend side)", () => {
  it("has at least the expected number of golden vectors", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(40);
  });

  it.each(vectors.map((v, i) => [i, v] as const))(
    "vector %i: %j matches the frontend economy formulas",
    (_i, v) => {
      const actual = call(v.fn, v.args);
      if (Number.isNaN(v.expected)) {
        expect(Number.isNaN(actual)).toBe(true);
      } else {
        expect(actual).toBeCloseTo(v.expected, 9);
      }
    }
  );
});
