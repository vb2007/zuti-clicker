import { describe, it, expect } from "vitest";
import { toHundredths, quoteSpin, consolationMs } from "@/utils/upgrader";
import vectorFile from "./fixtures/upgrader-vectors.json";

// Vitest/Vite import JSON modules natively, unlike ts-jest's ESM transform on
// the api side — see api/src/tests/upgrader-parity.test.ts, the other half of
// this pair, which reads the identical file via fs instead. Same vectors,
// checked here against the frontend's own formulas — this is what catches
// api/src/services/upgrader.ts silently drifting from this file's mirror.
type Vector = { fn: string; args: unknown[]; expected: number | null };
const vectors = (vectorFile as { vectors: Vector[] }).vectors;

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

describe("upgrader parity (frontend side)", () => {
  it("has at least the expected number of golden vectors", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(60);
  });

  it.each(vectors.map((v, i) => [i, v] as const))(
    "vector %i: %j matches the frontend upgrader maths",
    (_i, v) => {
      expect(call(v.fn, v.args)).toBe(v.expected);
    }
  );
});
