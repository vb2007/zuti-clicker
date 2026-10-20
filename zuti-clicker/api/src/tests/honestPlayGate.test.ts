import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import {
  evaluateSaveEnvelope,
  type PrevSaveSnapshot,
  type IncomingSave
} from "../services/saveValidator.js";
import { getCareerModifiers } from "../services/careerCore.js";

// The honest-play gate (CI's "Honest play" job). Every false ban so far came
// from the envelope not fitting something an honest client really does —
// prestige and an autosave in one interval, a guest's playtime before the
// account, a whole run between two saves. Nothing ran the real client against
// these bounds until the last of those, so this gate does it on every PR: the
// frontend's save-cadence sim (`pnpm sim:honest-play-gate`) plays the real
// game store through the real client save cadence and writes EVERY interval
// to HONEST_PLAY_FILE; each one must pass the real envelope. A new mechanic,
// or a bound tightened, that an honest player can fall foul of fails here
// instead of in production.
//
// Skipped when HONEST_PLAY_FILE isn't set (an ordinary local or api-tests
// run). The committed sample in prestigeIntervalEnvelope.test.ts always runs.
const file = process.env["HONEST_PLAY_FILE"];

interface Stream {
  purchaseOrder: string[];
  pairs: {
    source: string;
    hours: number;
    prestiged: boolean;
    dtMs: number;
    nodes: number;
    prev: Omit<PrevSaveSnapshot, "savedAt" | "career">;
    incoming: IncomingSave;
  }[];
}

(file ? describe : describe.skip)("honest-play gate", () => {
  it("every honest interval passes the envelope: no reject, no material clamp", () => {
    const stream = JSON.parse(readFileSync(file!, "utf8")) as Stream;
    const now = new Date(Date.UTC(2026, 9, 20, 12));
    const failures: string[] = [];
    let prestiged = 0;
    for (const pair of stream.pairs) {
      if (pair.prestiged) prestiged++;
      const prev: PrevSaveSnapshot = {
        ...pair.prev,
        savedAt: new Date(now.getTime() - pair.dtMs),
        career: getCareerModifiers(stream.purchaseOrder.slice(0, pair.nodes))
      };
      const verdict = evaluateSaveEnvelope(prev, new Date(0), now, pair.incoming);
      const failed =
        verdict.outcome === "reject" || (verdict.outcome === "clamp" && verdict.material);
      if (failed) {
        const what =
          verdict.outcome === "reject"
            ? `reject ${verdict.reason}`
            : `material clamp ${verdict.reasons.join("+")}`;
        failures.push(
          `${pair.source} @${pair.hours}h (${pair.prestiged ? "prestige" : "plain"}): ${what} ` +
            JSON.stringify(verdict.detail)
        );
      }
    }
    // The stream must actually exercise the hard case, or a passing gate
    // means nothing.
    expect(stream.pairs.length).toBeGreaterThan(10_000);
    expect(prestiged).toBeGreaterThan(1_000);
    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures).toHaveLength(0);
  });
});
