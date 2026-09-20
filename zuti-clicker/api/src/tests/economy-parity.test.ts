import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import {
  getUnitCost,
  getBulkCost,
  getPhdGain,
  getProductionMultiplier,
  getCostMultiplier,
  getFlatClickBonus,
  getClickMultiplier,
  getClickSynergy,
  getClickValue,
  type ClickValueParams
} from "../services/economy.js";
import { UNIT_DEFINITIONS } from "../constants/gameBalance.js";

type Vector = { fn: string; args: unknown[]; expected: number };

// Read via fs rather than a JSON module import — ts-jest's ESM transform
// does not reliably support import assertions/attributes across the Node
// versions this project targets, and plain fs avoids that entirely.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const vectors: Vector[] = (
  JSON.parse(
    readFileSync(path.join(__dirname, "fixtures/economy-vectors.json"), "utf-8")
  ) as { vectors: Vector[] }
).vectors;

// This is a pure unit test — no live server or database needed, unlike the
// rest of src/tests/. It exists to catch the one failure mode a
// "keep in sync with ..." comment can't: the two independently-maintained
// economy mirrors (this file's services/economy.ts and the frontend's
// utils/{costCalculator,prestige,upgrades}.ts) silently drifting apart.
// frontend/src/utils/__tests__/economy-parity.spec.ts is the other half —
// same vectors, checked against the frontend's own formulas.
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

describe("economy parity (api side)", () => {
  it("has at least the expected number of golden vectors", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(40);
  });

  it.each(vectors.map((v, i) => [i, v] as const))(
    "vector %i: %j matches the api economy service",
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
