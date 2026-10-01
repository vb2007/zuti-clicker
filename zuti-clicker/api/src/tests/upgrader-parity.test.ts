import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { toHundredths, quoteSpin, consolationMs } from "../services/upgrader.js";

type Vector = { fn: string; args: unknown[]; expected: number | null };

// Read via fs rather than a JSON module import — see economy-parity.test.ts
// for why (ts-jest's ESM transform and import attributes).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const vectors: Vector[] = (
  JSON.parse(readFileSync(path.join(__dirname, "fixtures/upgrader-vectors.json"), "utf-8")) as {
    vectors: Vector[];
  }
).vectors;

// A pure unit test — no live server or database needed. It catches the one
// failure mode a "keep in sync with ..." comment can't: the two independently
// maintained upgrader mirrors (this side's services/upgrader.ts and the
// frontend's utils/upgrader.ts) silently drifting apart, which would make the
// wheel the player sees disagree with the one the server rolls.
// frontend/src/utils/__tests__/upgrader-parity.spec.ts is the other half.
function call(fn: string, args: unknown[]): number | null {
  switch (fn) {
    case "toHundredths":
      return toHundredths(args[0] as number);
    case "quoteSpin.payout":
      return quoteSpin(args[0] as number, args[1] as number)?.payout ?? null;
    case "quoteSpin.winPpm":
      return quoteSpin(args[0] as number, args[1] as number)?.winPpm ?? null;
    case "consolationMs":
      return consolationMs(args[0] as number, args[1] as number);
    default:
      throw new Error(`Unknown vector function: ${fn}`);
  }
}

describe("upgrader parity (api side)", () => {
  it("has at least the expected number of golden vectors", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(60);
  });

  it.each(vectors.map((v, i) => [i, v] as const))(
    "vector %i: %j matches the api upgrader service",
    (_i, v) => {
      expect(call(v.fn, v.args)).toBe(v.expected);
    }
  );
});
